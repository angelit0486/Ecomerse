import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { resumeQueue } from "@/server/jobs/run-now";
import { log } from "@/server/observability/logger";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { publishIssueMessage } from "../../../messages";
import { AutoRefresh } from "../../auto-refresh";
import { CommitButton } from "../../commit-button";
import { importErrorText, MODE } from "../../labels";
import { NewCategories, type MissingCategory } from "../../new-categories";
import { PublishSummary, type BlockedProduct, type PublishTotals } from "../../publish-summary";
import { acceptBatchCategories, cancelImportBatch, commitImportBatch } from "../actions";
import { ReselectFile } from "./reselect-file";

export const metadata: Metadata = { title: "Importación por partes" };

// D8: esta página retoma la cola (una pasada del runner, hasta 55 s, después de
// responder) y sus acciones encolan partes; con el límite de 60 s de /api/jobs/run.
export const maxDuration = 60;

type Props = {
  params: Promise<{ storeHandle: string; batchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NOTICES: Record<string, string> = {
  "no-listo":
    "El lote no se puede aplicar todavía: revisa que todas las partes estén arriba y sin errores.",
  permiso:
    "Tu rol no permite aplicar este archivo (crear, editar o publicar productos, o ajustar existencias).",
  aplicando: "No se puede cancelar mientras una parte se está aplicando. Espera a que termine.",
  "no-cancelado": "No pudimos cancelar el lote. Recarga la página y vuelve a intentarlo.",
  categorias:
    "No pudimos usar esas categorías: revisa que sigan faltando y que se puedan crear, y vuelve a intentarlo.",
  "categorias-permiso": "Tu rol no puede crear categorías.",
};

const BATCH_STATUS: Record<string, string> = {
  uploading: "Subiendo partes",
  ready: "Listo para aplicar",
  running: "Aplicando",
  stopped: "Detenido",
  completed: "Terminado",
  cancelled: "Cancelado",
};

const newCategoriesSchema = z.object({
  can_create: z.boolean(),
  accepted: z.array(z.string()),
  missing: z.array(
    z.object({
      path: z.string(),
      key: z.string(),
      products: z.number().int(),
      creatable: z.boolean(),
      reason: z.string().nullable(),
      hint: z.string().nullable(),
      similar: z.array(z.string()).nullable(),
      accepted: z.boolean(),
    }),
  ),
});

interface PartJob {
  id: string;
  part_number: number;
  status: string;
  totals: Record<string, number | undefined>;
  error: string | null;
  part_fingerprint: string | null;
  created_at: string;
}

type PartTone = "Pendiente" | "Procesando" | "Aplicada" | "Error" | "Cancelada";

const n = (value: number | undefined) => (value ?? 0).toLocaleString("es-MX");

/** Estado de una parte en las palabras de la orden: Pendiente, Procesando, Aplicada, Error, Cancelada. */
function partState(job: PartJob | undefined): { state: PartTone; detail: string } {
  if (!job) return { state: "Pendiente", detail: "Falta subirla." };
  const t = job.totals ?? {};
  switch (job.status) {
    case "validated":
      return (t.errors ?? 0) > 0
        ? {
            state: "Error",
            detail: `${n(t.errors)} ${t.errors === 1 ? "fila" : "filas"} con error: corrígelas en tu archivo y vuelve a elegirlo aquí abajo.`,
          }
        : {
            state: "Pendiente",
            detail: `Lista: ${n(t.create)} por crear y ${n(t.update)} por actualizar.`,
          };
    case "committing":
      return { state: "Procesando", detail: "Aplicándose ahora: completa o nada." };
    case "completed":
      return {
        state: "Aplicada",
        detail: `${n(t.created)} creados y ${n(t.updated)} actualizados.`,
      };
    case "failed":
      return {
        state: "Error",
        detail:
          `No se pudo aplicar y no dejó ningún cambio. ${job.error ? importErrorText(job.error, publishIssueMessage) : ""}`.trim(),
      };
    case "cancelled":
      return { state: "Cancelada", detail: "No se aplicó." };
    default:
      return { state: "Pendiente", detail: "Revisando…" };
  }
}

const TONE: Record<PartTone, string> = {
  Pendiente: "border-border",
  Procesando: "border-accent",
  Aplicada: "border-success",
  Error: "border-danger",
  Cancelada: "border-border",
};

/** «1», «1 y 2», «1, 2 y 3». */
function listParts(parts: number[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

/**
 * Lote de una importación por partes (ADR-064 A): cada parte con su estado, la
 * advertencia explícita cuando quedó aplicado a medias, aplicar en orden,
 * retomar o corregir con el mismo archivo y cancelar lo que falta.
 */
export default async function ImportBatchPage({ params, searchParams }: Props) {
  const { storeHandle, batchId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "imports.run") || !z.uuid().safeParse(batchId).success) notFound();
  const sp = await searchParams;
  const notice =
    typeof sp.aviso === "string" && Object.hasOwn(NOTICES, sp.aviso)
      ? NOTICES[sp.aviso]
      : undefined;
  const base = `/admin/${ctx.store.handle}/productos/importar`;

  const supabase = await createSupabaseServerClient();
  const { data: batch } = await supabase
    .from("import_batches")
    .select(
      "id, file_name, mode, status, parts_count, part_rows, total_rows, stop_reason, created_at",
    )
    .eq("store_id", ctx.store.id)
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) notFound();
  const { data: jobRows } = await supabase
    .from("import_jobs")
    .select("id, part_number, status, totals, error, part_fingerprint, created_at")
    .eq("store_id", ctx.store.id)
    .eq("batch_id", batch.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const jobs = (jobRows ?? []) as PartJob[];
  const partsCount = batch.parts_count as number;
  const numbers = Array.from({ length: partsCount }, (_, i) => i + 1);
  // La importación viva de cada parte (como app.import_batch_part_job): la más
  // reciente que no se canceló, y una fallida solo si no hay otra.
  const live = new Map<number, PartJob>();
  for (const part of numbers) {
    const candidates = jobs.filter((j) => j.part_number === part && j.status !== "cancelled");
    const job = candidates.find((j) => j.status !== "failed") ?? candidates[0];
    if (job) live.set(part, job);
  }
  // En un lote cancelado se muestra la última de cada parte, aunque esté cancelada.
  const shown = (part: number) => live.get(part) ?? jobs.find((j) => j.part_number === part);

  const status = batch.status as string;
  const applied = numbers.filter((p) => live.get(p)?.status === "completed");
  const committing = numbers.find((p) => live.get(p)?.status === "committing");
  const missing = numbers.filter((p) => !live.has(p));
  const withErrors = numbers.filter((p) => partState(live.get(p)).state === "Error");
  const pending = numbers.filter((p) => !applied.includes(p));
  const editable = ["uploading", "ready", "stopped"].includes(status) && committing === undefined;
  const canCommit =
    editable &&
    missing.length === 0 &&
    withErrors.length === 0 &&
    pending.length > 0 &&
    pending.every((p) => live.get(p)?.status === "validated");
  if (committing !== undefined) resumeQueue("imports.batch");

  // Publicación de las partes ya aplicadas, sumada (Orden 10, mensaje 4).
  const appliedIds = applied.map((p) => live.get(p)!.id);
  const { data: runs } = appliedIds.length
    ? await supabase
        .from("publish_runs")
        .select("id, status, totals, error")
        .eq("store_id", ctx.store.id)
        .in("import_job_id", appliedIds)
    : { data: [] };
  const publishTotals: PublishTotals = { groups: {} };
  for (const run of runs ?? []) {
    const t = run.totals as PublishTotals;
    for (const key of [
      "candidates",
      "pending",
      "published",
      "already",
      "blocked",
      "skipped",
    ] as const) {
      publishTotals[key] = (publishTotals[key] ?? 0) + (t[key] ?? 0);
    }
    for (const [group, count] of Object.entries(t.groups ?? {})) {
      publishTotals.groups![group] = (publishTotals.groups![group] ?? 0) + count;
    }
  }
  const publishing = (runs ?? []).some((r) => r.status === "queued" || r.status === "running");
  if (publishing) resumeQueue("imports.publish");
  const publishFailed = (runs ?? []).find((r) => r.status === "failed");
  let blocked: BlockedProduct[] = [];
  if ((runs ?? []).length > 0 && (publishTotals.blocked ?? 0) > 0) {
    const { data: items } = await supabase
      .from("publish_run_items")
      .select("product_id, reasons")
      .eq("store_id", ctx.store.id)
      .in(
        "run_id",
        (runs ?? []).map((r) => r.id as string),
      )
      .eq("status", "blocked")
      .order("id")
      .limit(50);
    const ids = (items ?? []).map((i) => i.product_id as string);
    const { data: products } = ids.length
      ? await supabase
          .from("products")
          .select("id, title")
          .eq("store_id", ctx.store.id)
          .in("id", ids)
      : { data: [] };
    const titles = new Map((products ?? []).map((p) => [p.id as string, p.title as string]));
    blocked = (items ?? []).map((i) => ({
      id: i.product_id as string,
      title: titles.get(i.product_id as string) ?? "Producto",
      reasons: (i.reasons as string[]) ?? [],
    }));
  }

  // ADR-065 en el lote: categorías que faltan en todas las partes sin aplicar.
  let newCategories: z.infer<typeof newCategoriesSchema> | null = null;
  if (editable && numbers.some((p) => live.get(p)?.status === "validated")) {
    try {
      newCategories = newCategoriesSchema.parse(
        await callRpc<unknown>(supabase, "imports_batch_new_categories", {
          p_store_id: ctx.store.id,
          p_batch_id: batch.id,
        }),
      );
    } catch (error) {
      log.warn("imports.batch_categories_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const uploaded = numbers.flatMap((p) => {
    const job = live.get(p);
    return job
      ? [
          {
            part: p,
            status: job.status,
            fingerprint: job.part_fingerprint,
            errors: job.totals?.errors ?? 0,
          },
        ]
      : [];
  });
  const next = pending[0];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={base} className="underline">
            Importar productos
          </Link>
        </p>
        <h1 className="text-xl font-semibold">{batch.file_name}</h1>
        <p className="text-sm text-fg-muted">
          Importación por partes · {MODE[batch.mode as string] ?? batch.mode} ·{" "}
          {BATCH_STATUS[status] ?? status} · {n(batch.total_rows as number)} filas en {partsCount}{" "}
          {partsCount === 1 ? "parte" : "partes"}
        </p>
      </header>

      {notice ? (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm">
          {notice}
        </p>
      ) : null}

      {status === "running" ? (
        <p role="status" className="rounded-md border border-accent p-3 text-sm">
          {committing !== undefined
            ? `Aplicando la parte ${committing} de ${partsCount}. `
            : "Aplicando el lote. "}
          Cada parte se aplica completa o no se aplica; al terminar una sigue la siguiente. Puedes
          cerrar esta página: sigue en segundo plano.
          <AutoRefresh />
        </p>
      ) : null}
      {status === "uploading" && missing.length > 0 ? (
        <p role="status" className="rounded-md border border-warning p-3 text-sm">
          {missing.length === 1 ? "Falta subir la parte" : "Faltan subir las partes"}{" "}
          {listParts(missing)}. Vuelve a elegir el mismo archivo aquí abajo: lo que ya se subió no
          se repite.
        </p>
      ) : null}
      {status === "ready" && canCommit ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Todo listo: {partsCount} {partsCount === 1 ? "parte" : "partes"} sin errores. Al aplicar,
          las partes se aplican en orden y cada una completa o nada: si una falla, el lote se
          detiene en esa parte y las anteriores se quedan aplicadas.
        </p>
      ) : null}
      {status === "stopped" && canCommit ? (
        <div role="status" className="space-y-1 rounded-md border border-warning p-3 text-sm">
          <p className="font-medium">
            El lote está detenido en la parte {next}, que ya no tiene errores: continúa cuando
            quieras.
          </p>
          {batch.stop_reason ? (
            <p className="text-fg-muted">Motivo de la detención: {batch.stop_reason as string}</p>
          ) : null}
        </div>
      ) : null}
      {status === "stopped" && !canCommit ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger p-3 text-sm">
          <p className="font-medium">El lote se detuvo.</p>
          {batch.stop_reason ? <p>{batch.stop_reason as string}</p> : null}
        </div>
      ) : null}
      {status === "completed" ? (
        <p role="status" className="rounded-md border border-success p-3 text-sm">
          Lote terminado:{" "}
          {partsCount === 1 ? "la parte se aplicó" : `las ${partsCount} partes se aplicaron`}.{" "}
          <Link href={`/admin/${ctx.store.handle}/productos`} className="underline">
            Ver productos
          </Link>
        </p>
      ) : null}
      {status === "cancelled" ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          {(batch.stop_reason as string | null) ?? "Lote cancelado."}
        </p>
      ) : null}

      {applied.length > 0 && applied.length < partsCount ? (
        // El propietario aceptó lotes aplicados a medias, siempre a la vista (ADR-064 A).
        <p role="note" className="rounded-md border border-warning p-3 text-sm">
          <strong>Lote aplicado a medias.</strong>{" "}
          {applied.length === 1
            ? `La parte ${applied[0]} ya está en tu catálogo`
            : `Las partes ${listParts(applied)} ya están en tu catálogo`}{" "}
          y se queda{applied.length === 1 ? "" : "n"} aunque las demás no se apliquen.{" "}
          {pending.length === 1
            ? `La parte ${pending[0]} no ha cambiado`
            : `Las partes ${listParts(pending)} no han cambiado`}{" "}
          nada todavía.
        </p>
      ) : null}

      <section aria-labelledby="partes" className="space-y-2">
        <h2 id="partes" className="font-semibold">
          Partes del lote
        </h2>
        <ol aria-label="Partes" className="space-y-2">
          {numbers.map((part) => {
            const job = shown(part);
            const { state, detail } = partState(job);
            return (
              <li
                key={part}
                className={`flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm ${TONE[state]}`}
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    Parte {part}{" "}
                    <span className="font-normal text-fg-muted">
                      · {n((batch.part_rows as number[])[part - 1])} filas
                    </span>
                  </p>
                  <p>{detail}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{state}</span>
                  {job ? (
                    <Link href={`${base}/${job.id}`} className="underline">
                      Ver la parte {part}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {newCategories ? (
        <NewCategories
          missing={
            newCategories.missing.map((m) => ({
              ...m,
              similar: m.similar ?? [],
            })) as MissingCategory[]
          }
          accepted={newCategories.accepted}
          canCreate={newCategories.can_create}
          action={acceptBatchCategories.bind(null, ctx.store.handle, batch.id as string)}
        />
      ) : null}

      {canCommit ? (
        <form
          action={commitImportBatch.bind(null, ctx.store.handle, batch.id as string)}
          className="space-y-2"
        >
          <p className="text-sm">
            {applied.length > 0
              ? `Sigue con la parte ${next}: las partes ya aplicadas no se repiten.`
              : "Las partes se aplican en orden, cada una completa o nada."}
          </p>
          <CommitButton
            label={applied.length > 0 ? `Continuar con la parte ${next}` : "Aplicar el lote"}
          />
        </form>
      ) : null}

      {editable ? (
        <ReselectFile
          storeHandle={ctx.store.handle}
          batchId={batch.id as string}
          partsCount={partsCount}
          live={uploaded}
          missing={missing.length}
        />
      ) : null}

      {(runs ?? []).length > 0 ? (
        <PublishSummary
          status={publishing ? "running" : publishFailed ? "failed" : "completed"}
          totals={publishTotals}
          error={(publishFailed?.error as string | null) ?? null}
          blocked={blocked}
          productsBase={`/admin/${ctx.store.handle}/productos`}
        />
      ) : null}

      {editable ? (
        <details className="rounded-md border border-border p-4 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            Cancelar el lote
          </summary>
          <form
            action={cancelImportBatch.bind(null, ctx.store.handle, batch.id as string)}
            className="space-y-2"
          >
            <p>
              Las partes que no se han aplicado se cancelan y no cambian nada.
              {applied.length > 0
                ? " Las partes ya aplicadas se quedan en tu catálogo: cancelar no las deshace."
                : ""}
            </p>
            <CommitButton label="Sí, cancelar el lote" />
          </form>
        </details>
      ) : null}
    </section>
  );
}
