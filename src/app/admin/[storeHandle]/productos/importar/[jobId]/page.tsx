import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { commitImport } from "../actions";
import { CommitButton } from "../commit-button";
import { JOB_STATUS, MODE } from "../labels";

export const metadata: Metadata = { title: "Vista previa de la importación" };

type Props = {
  params: Promise<{ storeHandle: string; jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NOTICES: Record<string, string> = {
  importado: "Importación terminada.",
  fallo: "La importación se detuvo y no se cambió nada. Corrige el archivo y vuelve a subirlo.",
  "no-listo": "Esta importación no se puede confirmar (tiene errores o ya se procesó).",
};
const SHOWN_ROWS = 200;

interface Totals {
  rows?: number;
  create?: number;
  update?: number;
  errors?: number;
  created?: number;
  updated?: number;
}

/** Vista previa (F8-T04b): totales, filas con error y confirmación todo o nada. */
export default async function ImportJobPage({ params, searchParams }: Props) {
  const { storeHandle, jobId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "imports.run") || !z.uuid().safeParse(jobId).success) notFound();
  const sp = await searchParams;
  const notice = typeof sp.aviso === "string" ? NOTICES[sp.aviso] : undefined;

  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("import_jobs")
    .select("id, file_name, mode, status, totals, error, created_at, committed_at")
    .eq("store_id", ctx.store.id)
    .eq("id", jobId)
    .maybeSingle();
  if (!job) notFound();
  const totals = job.totals as Totals;
  const { data: rows } = await supabase
    .from("import_job_rows")
    .select("row_number, raw, errors, action")
    .eq("store_id", ctx.store.id)
    .eq("import_job_id", jobId)
    .eq("action", "error")
    .order("row_number")
    .limit(SHOWN_ROWS);
  const ready = job.status === "validated" && (totals.errors ?? 0) === 0;
  const base = `/admin/${ctx.store.handle}/productos/importar`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={base} className="underline">
            Importar productos
          </Link>
        </p>
        <h1 className="text-xl font-semibold">{job.file_name}</h1>
        <p className="text-sm text-fg-muted">
          {MODE[job.mode] ?? job.mode} · {JOB_STATUS[job.status] ?? job.status}
        </p>
      </header>

      {notice ? (
        <p
          role={sp.aviso === "importado" ? "status" : "alert"}
          className={`rounded-md border p-3 text-sm ${sp.aviso === "importado" ? "border-success" : "border-danger"}`}
        >
          {notice}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">Filas</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{totals.rows ?? 0}</dd>
        </div>
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">
            {job.status === "completed" ? "Creados" : "Por crear"}
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {job.status === "completed" ? (totals.created ?? 0) : (totals.create ?? 0)}
          </dd>
        </div>
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">
            {job.status === "completed" ? "Actualizados" : "Por actualizar"}
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {job.status === "completed" ? (totals.updated ?? 0) : (totals.update ?? 0)}
          </dd>
        </div>
        <div
          className={`rounded-md border p-4 ${(totals.errors ?? 0) > 0 ? "border-danger" : "border-border"}`}
        >
          <dt className="text-[13px] text-fg-muted">Filas con error</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{totals.errors ?? 0}</dd>
        </div>
      </dl>

      {job.status === "failed" && job.error ? (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm">
          {job.error}
        </p>
      ) : null}

      {ready ? (
        <form action={commitImport.bind(null, ctx.store.handle, job.id)} className="space-y-2">
          <p className="text-sm">
            Sin errores. Al confirmar se aplica todo junto: si algo falla, no se cambia nada.
          </p>
          <CommitButton label="Confirmar importación" />
        </form>
      ) : null}

      {job.status === "completed" ? (
        <p>
          <Link href={`/admin/${ctx.store.handle}/productos`} className="underline">
            Ver productos
          </Link>
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <section aria-labelledby="errores" className="space-y-2">
          <h2 id="errores" className="font-semibold">
            Errores por fila
          </h2>
          <p className="text-sm text-fg-muted">
            Corrige el archivo y vuelve a subirlo. La fila 1 es el encabezado.
            {(totals.errors ?? 0) > SHOWN_ROWS ? ` Se muestran las primeras ${SHOWN_ROWS}.` : ""}
          </p>
          <table className="w-full text-left text-sm">
            <thead className="text-[13px] text-fg-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Fila</th>
                <th className="py-1 pr-3 font-medium">Handle</th>
                <th className="py-1 font-medium">Qué corregir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.row_number} className="align-top">
                  <td className="py-2 pr-3 tabular-nums">{r.row_number}</td>
                  <td className="py-2 pr-3">
                    {String((r.raw as Record<string, unknown>).handle ?? "")}
                  </td>
                  <td className="py-2">
                    <ul className="space-y-0.5">
                      {(r.errors as string[]).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}
