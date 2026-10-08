import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { commitImport } from "../actions";
import { AutoRefresh } from "../auto-refresh";
import { CommitButton } from "../commit-button";
import { publishIssueMessage } from "../../messages";
import { importErrorText, JOB_STATUS, MODE } from "../labels";

export const metadata: Metadata = { title: "Vista previa de la importación" };

type Props = {
  params: Promise<{ storeHandle: string; jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NOTICES: Record<string, string> = {
  "no-listo": "Esta importación no se puede confirmar (tiene errores o ya se procesó).",
  permiso:
    "Tu rol no permite aplicar este archivo (crear, editar o publicar productos, o ajustar existencias).",
};
const SHOWN_ROWS = 200;

interface Totals {
  rows?: number;
  products?: number;
  create?: number;
  update?: number;
  errors?: number;
  created?: number;
  updated?: number;
}

/** Vista previa (F8-T04b, Gate F8): totales, avisos, errores por fila y confirmación. */
export default async function ImportJobPage({ params, searchParams }: Props) {
  const { storeHandle, jobId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "imports.run") || !z.uuid().safeParse(jobId).success) notFound();
  const sp = await searchParams;
  const notice =
    typeof sp.aviso === "string" && Object.hasOwn(NOTICES, sp.aviso)
      ? NOTICES[sp.aviso]
      : undefined;

  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("import_jobs")
    .select("id, file_name, mode, status, totals, error, ignored_columns, created_at, committed_at")
    .eq("store_id", ctx.store.id)
    .eq("id", jobId)
    .maybeSingle();
  if (!job) notFound();
  const totals = job.totals as Totals;
  const errors = totals.errors ?? 0;
  const { data: rows } = errors
    ? await supabase
        .from("import_job_rows")
        .select("row_number, raw, errors")
        .eq("store_id", ctx.store.id)
        .eq("import_job_id", jobId)
        .eq("action", "error")
        .order("row_number")
        .limit(SHOWN_ROWS)
    : { data: [] };
  const ready = job.status === "validated" && errors === 0;
  const done = job.status === "completed";
  const base = `/admin/${ctx.store.handle}/productos/importar`;
  const ignored = (job.ignored_columns as string[] | null) ?? [];

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
        <p role="alert" className="rounded-md border border-danger p-3 text-sm">
          {notice}
        </p>
      ) : null}

      {job.status === "committing" ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Importando… Puede tardar un par de minutos. Esta página se actualiza sola y puedes
          cerrarla: la importación sigue.
          <AutoRefresh />
        </p>
      ) : null}
      {done ? (
        <p role="status" className="rounded-md border border-success p-3 text-sm">
          Importación terminada.{" "}
          <Link href={`/admin/${ctx.store.handle}/productos`} className="underline">
            Ver productos
          </Link>
        </p>
      ) : null}
      {job.status === "failed" ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger p-3 text-sm">
          <p>La importación se detuvo y no se cambió nada.</p>
          {job.error ? <p>{importErrorText(job.error, publishIssueMessage)}</p> : null}
          <p>Corrige el archivo y vuelve a subirlo.</p>
        </div>
      ) : null}

      {ignored.length > 0 ? (
        <p className="rounded-md border border-warning p-3 text-sm">
          Se ignoraron columnas que no son de la plantilla: {ignored.join(", ")}.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">Filas</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{totals.rows ?? 0}</dd>
        </div>
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">
            {done ? "Productos creados" : "Productos por crear"}
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {done ? (totals.created ?? 0) : (totals.create ?? 0)}
          </dd>
        </div>
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">
            {done ? "Productos actualizados" : "Productos por actualizar"}
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {done ? (totals.updated ?? 0) : (totals.update ?? 0)}
          </dd>
        </div>
        <div className={`rounded-md border p-4 ${errors > 0 ? "border-danger" : "border-border"}`}>
          <dt className="text-[13px] text-fg-muted">Filas con error</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{errors}</dd>
        </div>
      </dl>

      {ready ? (
        <form action={commitImport.bind(null, ctx.store.handle, job.id)} className="space-y-2">
          <p className="text-sm">
            Sin errores. Al confirmar se aplica todo junto: si algo falla, no se cambia nada.
          </p>
          <CommitButton label="Confirmar importación" />
        </form>
      ) : null}

      {rows && rows.length > 0 ? (
        <section aria-labelledby="errores" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="errores" className="font-semibold">
              Errores por fila
            </h2>
            <a href={`${base}/${job.id}/errores`} className="text-sm underline">
              Descargar las filas con error (CSV)
            </a>
          </div>
          <p className="text-sm text-fg-muted">
            Corrige el archivo y vuelve a subirlo. La fila 1 es el encabezado.
            {errors > SHOWN_ROWS ? ` Se muestran las primeras ${SHOWN_ROWS}.` : ""}
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
