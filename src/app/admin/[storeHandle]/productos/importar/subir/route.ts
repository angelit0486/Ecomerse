import { NextResponse, type NextRequest } from "next/server";

import { CsvParseError, parseCsv } from "@/lib/csv-parse";
import { reportActionError } from "@/server/actions/report";
import { hasPermission } from "@/server/auth/context";
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
 * ≤ 4 MB (Vercel corta los cuerpos de más de 4.5 MB), ≤ 5 000 filas, UTF-8. El servidor arma el plan con los validadores del
 * editor; imports_create lo guarda y añade las validaciones contra la base. La
 * tienda sale de la URL (membresía verificada), nunca del archivo.
 */
type Params = { params: Promise<{ storeHandle: string }> };
const MODES = new Set(["create_only", "update_existing", "upsert"]);

export async function POST(request: NextRequest, { params }: Params) {
  const { storeHandle } = await params;
  const base = `/admin/${encodeURIComponent(storeHandle)}/productos/importar`;
  // El detalle viaja como códigos (nunca texto libre): la página lo traduce.
  const back = (error: string, detail?: string) => {
    const url = new URL(base, serverEnv().APP_URL);
    url.searchParams.set("error", error);
    if (detail) url.searchParams.set("detalle", detail.slice(0, 300));
    return NextResponse.redirect(url, 303);
  };
  if (request.headers.get("origin") !== new URL(serverEnv().APP_URL).origin) {
    return new NextResponse(null, { status: 403 });
  }
  // Sin Content-Length (cuerpo por trozos) no se lee: formData() lo cargaría
  // entero en memoria antes de poder medirlo. Los navegadores siempre lo envían.
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return new NextResponse(null, { status: 411 });
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return back("grande");

  // Sesión, tienda y permiso ANTES de leer el cuerpo (APP-H1/L1): nadie sin
  // imports.run hace trabajar al servidor con un archivo.
  let client: Awaited<ReturnType<typeof storeClient>>;
  try {
    client = await storeClient(storeHandle);
  } catch (error) {
    reportActionError("imports", error);
    return back("permiso");
  }
  if (!hasPermission(client.ctx, "imports.run")) return back("permiso");

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
    if (error instanceof CsvParseError) return back("formato", `${error.line}:${error.code}`);
    throw error;
  }
  const headers = checkHeaders(parsed.headers);
  if (!headers.ok) {
    return back("columnas", [...headers.missing, ...headers.duplicated].join(","));
  }
  if (parsed.rows.length === 0) return back("vacio");
  if (parsed.rows.length > MAX_IMPORT_ROWS) return back("filas");

  let jobId: string;
  try {
    const { supabase, storeId } = client;
    jobId = await callRpc<string>(supabase, "imports_create", {
      p_store_id: storeId,
      p_mode: mode,
      p_file_name: file.name.slice(0, 200) || "archivo.csv",
      p_columns: headers.columns,
      p_ignored: headers.ignored,
      p_rows: planProductImport(parsed.headers, parsed.rows, parsed.rowNumbers),
    });
  } catch (error) {
    reportActionError("imports", error);
    return back("permiso");
  }
  return NextResponse.redirect(new URL(`${base}/${jobId}`, serverEnv().APP_URL), 303);
}
