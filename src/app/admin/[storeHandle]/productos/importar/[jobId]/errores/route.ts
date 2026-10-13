import { NextResponse } from "next/server";
import { z } from "zod";

import { toCsv } from "@/lib/csv";
import { reportActionError } from "@/server/actions/report";
import { hasPermission } from "@/server/auth/context";
import { ALL_IMPORT_HEADERS } from "@/server/imports/products";

import { storeClient } from "../../../../_shared/action-state";

/**
 * CSV de errores de una importación (GATE0 §26.1 paso 3): las filas con error,
 * con sus columnas originales, el número de fila y qué corregir. Lectura con la
 * sesión del usuario (RLS: imports.run de ESA tienda).
 */
type Params = { params: Promise<{ storeHandle: string; jobId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { storeHandle, jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) return new NextResponse(null, { status: 404 });
  try {
    const { supabase, storeId, ctx } = await storeClient(storeHandle);
    if (!hasPermission(ctx, "imports.run")) return new NextResponse(null, { status: 404 });
    const { data: job } = await supabase
      .from("import_jobs")
      .select("id, file_name, columns")
      .eq("store_id", storeId)
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return new NextResponse(null, { status: 404 });
    const { data: rows, error } = await supabase
      .from("import_job_rows")
      .select("row_number, raw, errors")
      .eq("store_id", storeId)
      .eq("import_job_id", jobId)
      .eq("action", "error")
      .order("row_number")
      .limit(5000);
    if (error) throw error;
    const columns = ALL_IMPORT_HEADERS.filter((h) => (job.columns as string[]).includes(h));
    const csv = toCsv(
      ["fila", "errores", ...columns],
      (rows ?? []).map((r) => {
        const raw = r.raw as Record<string, string>;
        return [
          r.row_number,
          (r.errors as string[]).join(" · "),
          ...columns.map((c) => raw[c] ?? ""),
        ];
      }),
    );
    const name = String(job.file_name)
      .replace(/\.csv$/i, "")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 80);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name || "importacion"}-errores.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    reportActionError("imports", error);
    return new NextResponse(null, { status: 404 });
  }
}
