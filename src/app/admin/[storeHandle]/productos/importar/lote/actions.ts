"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { MAX_BATCH_PARTS, MAX_PART_ROWS, type UploadedPart } from "@/lib/imports/split";
import { reportActionError } from "@/server/actions/report";
import { hasPermission } from "@/server/auth/context";
import { callRpc } from "@/server/db/rpc";
import { checkHeaders } from "@/server/imports/products";
import { processQueueSoon } from "@/server/jobs/run-now";

import { storeClient } from "../../../_shared/action-state";

const uuid = z.uuid();
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

const startSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mode: z.enum(["create_only", "update_existing", "upsert"]),
  headers: z.array(z.string().max(200)).min(1).max(100),
  partRows: z.array(z.number().int().min(1).max(MAX_PART_ROWS)).min(1).max(MAX_BATCH_PARTS),
  partFingerprints: z.array(hex64).min(1).max(MAX_BATCH_PARTS),
  fileFingerprint: hex64,
});

const partSchema = z.object({
  part: z.number().int(),
  status: z.string(),
  fingerprint: z.string().nullable(),
  errors: z.number().int(),
});

export type BatchStart =
  | { ok: true; batchId: string; resumed: boolean; parts: UploadedPart[] }
  | { ok: false; message: string };

/**
 * ADR-064 A: crea el lote de un archivo grande (o retoma el del mismo archivo) y
 * dice qué partes ya se subieron. El navegador ya partió el archivo; aquí se
 * revisan los encabezados con el validador del servidor antes de crear nada.
 */
export async function startImportBatch(storeHandle: string, input: unknown): Promise<BatchStart> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success || parsed.data.partRows.length !== parsed.data.partFingerprints.length) {
    return { ok: false, message: "No pudimos preparar el archivo. Vuelve a elegirlo." };
  }
  const data = parsed.data;
  const headers = checkHeaders(data.headers);
  if (!headers.ok) {
    return {
      ok: false,
      message: `Revisa los encabezados del archivo: falta o está repetida: ${[...headers.missing, ...headers.duplicated].join(", ")}.`,
    };
  }
  try {
    const { supabase, storeId, ctx } = await storeClient(storeHandle);
    if (!hasPermission(ctx, "imports.run")) {
      return { ok: false, message: "Tu rol no permite importar productos." };
    }
    const result = z
      .object({ batch_id: uuid, resumed: z.boolean(), parts: z.array(partSchema) })
      .parse(
        await callRpc<unknown>(supabase, "imports_batch_create", {
          p_store_id: storeId,
          p_file_name: data.fileName,
          p_mode: data.mode,
          p_part_rows: data.partRows,
          p_part_fingerprints: data.partFingerprints,
          p_file_fingerprint: data.fileFingerprint,
        }),
      );
    return { ok: true, batchId: result.batch_id, resumed: result.resumed, parts: result.parts };
  } catch (error) {
    const e = reportActionError("imports.batch", error);
    if (e.code === "rate_limited") {
      return {
        ok: false,
        message: `Este archivo se importa en ${data.partRows.length} partes y no caben en el tope de 30 importaciones por hora. Espera un rato y vuelve a elegirlo.`,
      };
    }
    if (e.code === "forbidden")
      return { ok: false, message: "Tu rol no permite importar productos." };
    return { ok: false, message: "No pudimos preparar la importación. Vuelve a intentarlo." };
  }
}

const batchPath = (storeHandle: string, batchId: string) =>
  `/admin/${storeHandle}/productos/importar/lote/${batchId}`;

/** Detalle del RAISE de la base (PostgREST lo manda como `details`). */
function dbDetail(cause: unknown): string | undefined {
  const c = cause as { details?: unknown; detail?: unknown } | null | undefined;
  const d = c?.details ?? c?.detail;
  return typeof d === "string" ? d : undefined;
}

/**
 * Aplica el lote en orden (o continúa donde se detuvo): la base empieza la
 * primera parte que falta y el worker sigue con las demás, cada una todo o nada.
 */
export async function commitImportBatch(storeHandle: string, batchId: string): Promise<void> {
  if (!uuid.safeParse(batchId).success) redirect(`/admin/${storeHandle}/productos/importar`);
  const path = batchPath(storeHandle, batchId);
  let notice = "";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "imports_batch_commit", { p_store_id: storeId, p_batch_id: batchId });
    processQueueSoon("imports.batch_commit");
  } catch (error) {
    const e = reportActionError("imports.batch", error);
    notice = e.code === "forbidden" ? "?aviso=permiso" : "?aviso=no-listo";
  }
  revalidatePath(path);
  redirect(`${path}${notice}`);
}

/** Cancela lo que falta del lote; lo ya aplicado se queda en el catálogo. */
export async function cancelImportBatch(storeHandle: string, batchId: string): Promise<void> {
  if (!uuid.safeParse(batchId).success) redirect(`/admin/${storeHandle}/productos/importar`);
  const path = batchPath(storeHandle, batchId);
  let notice = "";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "imports_batch_cancel", { p_store_id: storeId, p_batch_id: batchId });
  } catch (error) {
    const e = reportActionError("imports.batch", error);
    notice = dbDetail(e.cause) === "batch_processing" ? "?aviso=aplicando" : "?aviso=no-cancelado";
  }
  revalidatePath(path);
  redirect(`${path}${notice}`);
}

/** ADR-065 en un lote: las categorías que se crearán, iguales para todas sus partes. */
export async function acceptBatchCategories(
  storeHandle: string,
  batchId: string,
  formData: FormData,
): Promise<void> {
  if (!uuid.safeParse(batchId).success) redirect(`/admin/${storeHandle}/productos/importar`);
  const path = batchPath(storeHandle, batchId);
  const paths =
    formData.get("intent") === "clear"
      ? []
      : [...new Set(formData.getAll("paths").map(String))].filter((p) => p.trim()).slice(0, 200);
  let notice = "";
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "imports_batch_accept_categories", {
      p_store_id: storeId,
      p_batch_id: batchId,
      p_paths: paths,
    });
  } catch (error) {
    const e = reportActionError("imports.categories", error);
    notice = e.code === "forbidden" ? "?aviso=categorias-permiso" : "?aviso=categorias";
  }
  revalidatePath(path);
  redirect(`${path}${notice}`);
}
