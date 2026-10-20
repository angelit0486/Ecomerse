import { NextResponse, type NextRequest } from "next/server";

import { CsvParseError, parseCsv } from "@/lib/csv-parse";
import { translatePlatformCsv } from "@/lib/imports/platforms";
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

  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Excel en México guarda «CSV» en Windows-1252 (Latin-1): ñ y acentos se
    // leen bien con esa tabla. Un archivo binario sigue sin pasar el lector CSV.
    text = new TextDecoder("windows-1252").decode(bytes);
    if (text.includes("\u0000")) return back("codificacion");
  }
  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvParseError) return back("formato", `${error.line}:${error.code}`);
    throw error;
  }
  // Archivos exportados de Shopify o Tiendanube se traducen a las columnas de
  // PRUVA antes de validar; el formato propio pasa igual.
  const source = translatePlatformCsv(parsed.headers, parsed.rows, parsed.rowNumbers);
  const headers = checkHeaders(source.headers);
  if (!headers.ok) {
    return back("columnas", [...headers.missing, ...headers.duplicated].join(","));
  }
  if (source.rows.length === 0) return back("vacio");
  if (source.rows.length > MAX_IMPORT_ROWS) return back("filas");

  let jobId: string;
  try {
    const { supabase, storeId } = client;
    jobId = await callRpc<string>(supabase, "imports_create", {
      p_store_id: storeId,
      p_mode: mode,
      p_file_name: file.name.slice(0, 200) || "archivo.csv",
      p_columns: headers.columns,
      // La base guarda hasta 50 columnas ignoradas, solo para informar.
      p_ignored: [...new Set([...source.ignored, ...headers.ignored])]
        .slice(0, 50)
        .map((h) => h.slice(0, 100)),
      p_rows: planProductImport(source.headers, source.rows, source.rowNumbers),
    });
  } catch (error) {
    const e = reportActionError("imports", error);
    // G-L2: un archivo que la base rechaza por su forma no es un problema de permisos.
    if (e.fields?.too_many_rows) return back("filas");
    if (e.fields?.columns) return back("columnas");
    return back("permiso");
  }
  const done = new URL(`${base}/${jobId}`, serverEnv().APP_URL);
  if (source.platform !== "pruva") {
    done.searchParams.set("origen", source.platform);
    if (source.productsWithImageUrl > 0) {
      done.searchParams.set("con_foto", String(source.productsWithImageUrl));
    }
  }
  return NextResponse.redirect(done, 303);
}
