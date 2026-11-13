import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { MAX_BATCH_PARTS, MAX_PART_BYTES } from "@/lib/imports/split";
import { reportActionError } from "@/server/actions/report";
import { hasPermission } from "@/server/auth/context";
import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";
import { AppError, errorResponse } from "@/server/errors";
import { partRejection, readPartBody, type PartFailure } from "@/server/imports/parts";
import { requestIdFrom } from "@/server/observability/request-id";

import { storeClient } from "../../../../../../_shared/action-state";

/**
 * Subida de UNA parte de un lote (ADR-064 A). El navegador partió el archivo y
 * manda cada parte como JSON (≤ 3.5 MB, ≤ 5,000 filas) ya en el formato de la
 * tienda. Aquí se valida igual que un archivo subido (encabezados, plan, mismos
 * validadores) e imports_create_part la guarda: idempotente por huella, sin
 * productos repartidos entre partes y dentro del tope de importaciones. La tienda
 * sale de la URL (membresía verificada) y el lote debe ser de esa tienda.
 */
type Params = { params: Promise<{ storeHandle: string; batchId: string; part: string }> };

// Planear y validar 5,000 filas puede pasar de los 10-15 s por omisión (D8).
export const maxDuration = 60;

const FAILURES: Record<PartFailure, string> = {
  formato: "No pudimos leer esta parte. Vuelve a elegir el archivo.",
  columnas: "Revisa los encabezados del archivo.",
  filas: "Una parte no puede tener más de 5,000 filas.",
};

export async function POST(request: NextRequest, { params }: Params) {
  const requestId = requestIdFrom(request.headers);
  const { storeHandle, batchId, part } = await params;
  if (request.headers.get("origin") !== new URL(serverEnv().APP_URL).origin) {
    return new NextResponse(null, { status: 403 });
  }
  const partNumber = Number(part);
  if (
    !z.uuid().safeParse(batchId).success ||
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > MAX_BATCH_PARTS
  ) {
    return errorResponse(new AppError("not_found", "No encontramos ese lote."), requestId);
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return new NextResponse(null, { status: 415 });
  }
  // Sin Content-Length no se lee (igual que la subida de un archivo).
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return new NextResponse(null, { status: 411 });
  if (length > MAX_PART_BYTES) return new NextResponse(null, { status: 413 });

  // Sesión, tienda y permiso ANTES de leer el cuerpo.
  let client: Awaited<ReturnType<typeof storeClient>>;
  try {
    client = await storeClient(storeHandle);
  } catch (error) {
    return errorResponse(reportActionError("imports.batch", error), requestId);
  }
  if (!hasPermission(client.ctx, "imports.run")) {
    return errorResponse(
      new AppError("forbidden", partRejection("forbidden", undefined, undefined)),
      requestId,
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_PART_BYTES) return new NextResponse(null, { status: 413 });
  const read = readPartBody(bytes);
  if (!read.ok) {
    const fields = read.detail ? { [read.code]: read.detail.slice(0, 200) } : undefined;
    return errorResponse(
      new AppError("validation_failed", FAILURES[read.code], { fields }),
      requestId,
    );
  }

  try {
    const result = await callRpc<{ job_id: string; reused: boolean }>(
      client.supabase,
      "imports_create_part",
      {
        p_store_id: client.storeId,
        p_batch_id: batchId,
        p_part: partNumber,
        p_fingerprint: read.fingerprint,
        p_columns: read.columns,
        p_ignored: read.ignored,
        p_rows: read.rows,
      },
    );
    return NextResponse.json(
      { ok: true, job_id: result.job_id, reused: result.reused },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const e = reportActionError("imports.batch", error);
    const cause = e.cause as { details?: unknown; detail?: unknown; hint?: unknown } | undefined;
    const detail = [cause?.details, cause?.detail].find((d): d is string => typeof d === "string");
    const hint = typeof cause?.hint === "string" ? cause.hint : undefined;
    return errorResponse(new AppError(e.code, partRejection(e.code, detail, hint)), requestId);
  }
}
