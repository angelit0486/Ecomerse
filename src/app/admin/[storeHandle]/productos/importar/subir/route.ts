import { NextResponse, type NextRequest } from "next/server";

import { CsvParseError, parseCsv } from "@/lib/csv-parse";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";
import {
  checkHeaders,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  planProductImport,
} from "@/server/imports/products";

import { storeClient } from "../../../_shared/action-state";

/**
 * Subida del CSV (F8-T04b, §26.1). POST multipart desde el panel: mismo origen,
 * ≤ 5 MB, ≤ 5 000 filas, UTF-8. El servidor arma el plan con los validadores del
 * editor; imports_create lo guarda y añade las validaciones contra la base. La
 * tienda sale de la URL (membresía verificada), nunca del archivo.
 */
type Params = { params: Promise<{ storeHandle: string }> };
const MODES = new Set(["create_only", "update_existing", "upsert"]);

export async function POST(request: NextRequest, { params }: Params) {
  const { storeHandle } = await params;
  const base = `/admin/${encodeURIComponent(storeHandle)}/productos/importar`;
  const back = (error: string, detail?: string) => {
    const url = new URL(base, serverEnv().APP_URL);
    url.searchParams.set("error", error);
    if (detail) url.searchParams.set("detalle", detail.slice(0, 300));
    return NextResponse.redirect(url, 303);
  };
  if (request.headers.get("origin") !== new URL(serverEnv().APP_URL).origin) {
    return new NextResponse(null, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 64 * 1024) {
    return back("grande");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back("archivo");
  }
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "");
  if (!MODES.has(mode)) return back("modo");
  if (!(file instanceof File) || file.size === 0) return back("archivo");
  if (file.size > MAX_IMPORT_BYTES) return back("grande");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return back("codificacion");
  }
  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvParseError) return back("formato", `fila ${error.line}`);
    throw error;
  }
  const headers = checkHeaders(parsed.headers);
  if (!headers.ok) {
    const parts = [
      headers.missing.length ? `faltan: ${headers.missing.join(", ")}` : "",
      headers.unknown.length ? `desconocidas: ${headers.unknown.join(", ")}` : "",
    ].filter(Boolean);
    return back("columnas", parts.join(" · "));
  }
  if (parsed.rows.length === 0) return back("vacio");
  if (parsed.rows.length > MAX_IMPORT_ROWS) return back("filas");

  let jobId: string;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    jobId = await callRpc<string>(supabase, "imports_create", {
      p_store_id: storeId,
      p_mode: mode,
      p_file_name: file.name.slice(0, 200) || "archivo.csv",
      p_rows: planProductImport(parsed.headers, parsed.rows),
    });
  } catch (error) {
    reportActionError("imports", error);
    return back("permiso");
  }
  return NextResponse.redirect(new URL(`${base}/${jobId}`, serverEnv().APP_URL), 303);
}
