import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { resumeQueue } from "@/server/jobs/run-now";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { commitImport } from "../actions";
import { AutoRefresh } from "../auto-refresh";
import { CommitButton } from "../commit-button";
import { publishIssueMessage } from "../../messages";
import { COLUMN_LABELS, friendlyRowError, importErrorText, JOB_STATUS, MODE } from "../labels";

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

/** Fecha de hace `h` horas para filtrar (fuera del render: la consulta es por petición). */
function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

/**
 * Columnas con más errores (plan del panel, B3): con un catálogo de cientos de
 * filas, corregir por columna es más rápido que fila por fila.
 */
function errorsByColumn(rows: { errors: unknown }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const columns = new Set(
      (row.errors as string[]).map((e) => /^([a-z0-9_]+):/.exec(e)?.[1] ?? "otros"),
    );
    for (const column of columns) counts.set(column, (counts.get(column) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

const PLATFORM_NAMES: Record<string, string> = { shopify: "Shopify", tiendanube: "Tiendanube" };

/** Vista previa (F8-T04b, Gate F8): totales, avisos, errores por fila y confirmación. */
export default async function ImportJobPage({ params, searchParams }: Props) {
  const { storeHandle, jobId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "imports.run") || !z.uuid().safeParse(jobId).success) notFound();
  const sp = await searchParams;
  // Archivo de otra plataforma traducido al subirlo (ver lib/imports/platforms).
  const origin =
    typeof sp.origen === "string" && Object.hasOwn(PLATFORM_NAMES, sp.origen)
      ? PLATFORM_NAMES[sp.origen]
      : undefined;
  const withPhotoUrl = typeof sp.con_foto === "string" ? Number(sp.con_foto) : 0;
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
  // La importación confirmada espera en la cola: se retoma al mirarla (D-LOTE-05).
  if (job.status === "committing") resumeQueue("imports.page");
  // El mismo archivo ya se importa o se importó hace poco: se avisa antes de
  // confirmar (antes, confirmar dos veces fallaba con «ya existe ese handle»).
  const { data: twins } =
    job.status === "validated"
      ? await supabase
          .from("import_jobs")
          .select("status, committed_at, created_at")
          .eq("store_id", ctx.store.id)
          .eq("file_name", job.file_name)
          .neq("id", job.id)
          .in("status", ["committing", "completed"])
          .gte("created_at", hoursAgoIso(24))
          .order("created_at", { ascending: false })
          .limit(1)
      : { data: [] };
  const twin = twins?.[0] as { status: string; committed_at: string | null } | undefined;
  const ready = job.status === "validated" && errors === 0 && twin?.status !== "committing";
  const done = job.status === "completed";
  const base = `/admin/${ctx.store.handle}/productos/importar`;
  const ignored = (job.ignored_columns as string[] | null) ?? [];
  const byColumn = rows && rows.length > 0 ? errorsByColumn(rows) : [];
  const handleTaken =
    job.mode === "create_only" &&
    (rows ?? []).some((r) =>
      (r.errors as string[]).some((e) => e.startsWith("handle: ya existe un producto")),
    );

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
      {origin && job.status === "validated" ? (
        <div role="status" className="space-y-1 rounded-md border border-border p-3 text-sm">
          <p>
            Leímos tu archivo de {origin} y lo pasamos al formato de PRUVA: nombre, descripción,
            marca, etiquetas, presentaciones, precios, existencias, peso y SEO. Las categorías no se
            copian: asígnalas después en bloque desde Productos.
          </p>
          {Number.isInteger(withPhotoUrl) && withPhotoUrl > 0 ? (
            <p>
              {withPhotoUrl === 1
                ? "1 producto trae su foto como enlace: no la descargamos de internet."
                : `${withPhotoUrl} productos traen sus fotos como enlaces: no las descargamos de internet.`}{" "}
              Cuando termine la importación, sube todas las fotos de una vez desde tu computadora.
            </p>
          ) : null}
        </div>
      ) : null}
      {done ? (
        <p role="status" className="rounded-md border border-success p-3 text-sm">
          Importación terminada.{" "}
          <Link href={`/admin/${ctx.store.handle}/productos`} className="underline">
            Ver productos
          </Link>
          {hasPermission(ctx, "products.update") ? (
            <>
              {" · "}
              <Link href={`${base}/imagenes`} className="font-medium underline">
                Subir las fotos de todos los productos
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {job.status === "failed" ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger p-3 text-sm">
          <p>La importación se detuvo y no se cambió nada.</p>
          {job.error ? <p>{importErrorText(job.error, publishIssueMessage)}</p> : null}
          {job.error?.includes("ya existe un producto con ese handle") ? (
            <p>
              Ese producto ya está en tu catálogo (quizá de una importación anterior). Para
              actualizarlo, vuelve a subir el archivo eligiendo «Crear los nuevos y actualizar los
              existentes».
            </p>
          ) : (
            <p>Corrige el archivo y vuelve a subirlo.</p>
          )}
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

      {twin?.status === "committing" ? (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          Este mismo archivo ya se está importando. Espera a que termine en{" "}
          <Link href={base} className="underline">
            Importaciones recientes
          </Link>{" "}
          antes de confirmarlo otra vez.
        </p>
      ) : null}
      {twin?.status === "completed" && job.status === "validated" ? (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          Un archivo con este nombre ya se importó
          {twin.committed_at
            ? ` el ${new Date(twin.committed_at).toLocaleString("es-MX", { timeZone: ctx.store.timezone, dateStyle: "short", timeStyle: "short" })}`
            : ""}
          . Si es el mismo, no lo confirmes de nuevo: los productos ya están en tu catálogo.
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

      {(errors > 0 && job.status === "validated") || job.status === "failed" ? (
        <form
          method="post"
          action={`${base}/subir`}
          encType="multipart/form-data"
          className="space-y-2 rounded-md border border-border p-4"
        >
          <input type="hidden" name="mode" value={job.mode} />
          <label htmlFor="archivo-corregido" className="block text-sm font-medium">
            Corrige el archivo y súbelo aquí de nuevo
          </label>
          <p className="text-[13px] text-fg-muted">
            Se valida otra vez con el mismo modo ({MODE[job.mode] ?? job.mode}). No se cambia nada
            hasta que confirmes.
          </p>
          <input
            id="archivo-corregido"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block min-h-11 text-sm"
          />
          <button
            type="submit"
            className="inline-flex h-11 items-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            Validar el archivo corregido
          </button>
        </form>
      ) : null}

      {rows && rows.length > 0 ? (
        <section aria-labelledby="errores" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="errores" className="font-semibold">
              Errores por fila
            </h2>
            <a
              href={`${base}/${job.id}/errores`}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              Descargar las filas con error (CSV)
            </a>
          </div>
          <p className="text-sm text-fg-muted">
            Corrige el archivo y vuelve a subirlo. La fila 1 es el encabezado.
            {errors > SHOWN_ROWS ? ` Se muestran las primeras ${SHOWN_ROWS}.` : ""}
          </p>
          {byColumn.length > 1 ? (
            <p className="text-sm">
              Por columna:{" "}
              {byColumn
                .map(
                  ([column, count]) =>
                    `${COLUMN_LABELS[column] ?? column} (${count} ${count === 1 ? "fila" : "filas"})`,
                )
                .join(", ")}
              .
            </p>
          ) : null}
          {handleTaken ? (
            <p className="rounded-md border border-warning p-3 text-sm">
              Algunos productos ya están en tu catálogo. Si quieres actualizarlos con este archivo,
              vuelve a subirlo eligiendo «Crear los nuevos y actualizar los existentes».
            </p>
          ) : null}
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
                        <li key={i}>{friendlyRowError(e)}</li>
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
