"use server";

import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { hasPermission } from "@/server/auth/context";
import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";
import { log } from "@/server/observability/logger";
import {
  checkPhotoLinks,
  displayLink,
  PHOTO_CHECK_LABELS,
  PHOTO_CHECK_LIMITS,
  type PhotoCheckStatus,
} from "@/server/imports/photo-check";

import { storeClient } from "../../_shared/action-state";

/**
 * Revisar los enlaces de fotos de una importación antes de confirmarla (Orden 10,
 * O10-04). D3 (mensaje 4): la base decide si se revisa, se reutiliza el
 * resultado o se espera (imports_photo_check_begin), con topes por tienda, por
 * importación y de la plataforma que no dependen de la memoria de una instancia.
 * El resultado se guarda sin la consulta de cada enlace (puede llevar una firma).
 */
export type PhotoCheckState =
  | { state: "idle" }
  | { state: "error"; message: string }
  | {
      state: "done";
      total: number;
      checked: number;
      ok: number;
      problems: { row: number; handle: string; link: string; status: string; label: string }[];
      more: number;
      reused: boolean;
      /** Minutos desde que se hizo la revisión (0 si es nueva). */
      minutesAgo: number;
      retryAfterSeconds: number;
    };

const uuid = z.uuid();
const SHOWN = 200;
const REUSE_MINUTES = 10;

const STATUSES = [
  "ok",
  "blocked",
  "not_found",
  "no_domain",
  "too_large",
  "failed",
  "not_image",
  "not_checked",
] as const satisfies readonly PhotoCheckStatus[];

const storedResult = z.object({
  total: z.number().int().min(0),
  checked: z.number().int().min(0),
  counts: z.partialRecord(z.enum(STATUSES), z.number().int().min(0)),
  problems: z.array(
    z.object({
      row: z.number().int(),
      handle: z.string(),
      link: z.string(),
      status: z.enum(STATUSES),
    }),
  ),
  more: z.number().int().min(0).default(0),
});
type StoredResult = z.infer<typeof storedResult>;

const beginResult = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    check_id: z.uuid(),
    total_links: z.number().int().min(1),
    links: z.array(z.object({ url: z.string(), row: z.number().int(), handle: z.string() })),
  }),
  z.object({
    action: z.literal("reuse"),
    finished_at: z.string(),
    result: storedResult,
    retry_after_seconds: z.number().int().min(0),
  }),
  z.object({
    action: z.enum(["running", "busy", "busy_platform", "rate_limited", "no_links"]),
  }),
]);

const WAIT_MESSAGES: Record<string, string> = {
  running: "Ya estamos revisando estos enlaces. Espera unos segundos y vuelve a intentarlo.",
  busy: "Tu tienda ya está revisando los enlaces de otra importación. Inténtalo en un minuto.",
  busy_platform: "Hay muchas revisiones en curso. Inténtalo en un minuto.",
  rate_limited:
    "Tu tienda llegó al máximo de 10 revisiones por hora. Inténtalo más tarde o confirma la importación: las fotos se revisan otra vez al descargarlas.",
  no_links: "Este archivo no trae enlaces de fotos.",
};

function toState(
  result: StoredResult,
  meta: { reused: boolean; minutesAgo: number; retryAfterSeconds: number },
): PhotoCheckState {
  return {
    state: "done",
    total: result.total,
    checked: result.checked,
    ok: result.counts.ok ?? 0,
    problems: result.problems.map((p) => ({
      ...p,
      label: PHOTO_CHECK_LABELS[p.status as Exclude<PhotoCheckStatus, "ok">],
    })),
    more: result.more,
    ...meta,
  };
}

export async function checkImportPhotos(
  storeHandle: string,
  jobId: string,
  force: boolean,
): Promise<PhotoCheckState> {
  if (!uuid.safeParse(jobId).success) return { state: "error", message: "Importación no válida." };
  let started: { checkId: string; storeId: string } | null = null;
  try {
    const { ctx, supabase, storeId } = await storeClient(storeHandle);
    if (!hasPermission(ctx, "imports.run") || !hasPermission(ctx, "products.update")) {
      return { state: "error", message: "Tu rol no puede revisar las fotos de esta importación." };
    }
    const begin = beginResult.parse(
      await callRpc<unknown>(supabase, "imports_photo_check_begin", {
        p_store_id: storeId,
        p_job_id: jobId,
        p_force: force,
      }),
    );
    if (begin.action === "reuse") {
      return toState(begin.result, {
        reused: true,
        minutesAgo: Math.max(0, Math.floor((Date.now() - Date.parse(begin.finished_at)) / 60_000)),
        retryAfterSeconds: begin.retry_after_seconds,
      });
    }
    if (begin.action !== "start") {
      return { state: "error", message: WAIT_MESSAGES[begin.action]! };
    }
    started = { checkId: begin.check_id, storeId };

    const testOrigin = serverEnv().REMOTE_FETCH_TEST_ORIGIN;
    const result = await checkPhotoLinks(begin.links, testOrigin ? { testOrigin } : {});
    // Más de 500 enlaces distintos: los que no se mandaron quedan sin revisar.
    const beyond = Math.max(0, begin.total_links - begin.links.length);
    const problems = result.problems.map((p) => ({
      row: p.row,
      handle: p.handle.slice(0, 200),
      link: displayLink(p.url),
      status: p.status,
    }));
    const stored: StoredResult = {
      total: begin.total_links,
      checked: result.checked,
      counts: { ...result.counts, not_checked: result.counts.not_checked + beyond },
      problems: problems.slice(0, SHOWN),
      more: Math.max(0, problems.length - SHOWN) + beyond,
    };
    await callRpc(supabase, "imports_photo_check_finish", {
      p_store_id: storeId,
      p_check_id: begin.check_id,
      p_result: stored,
    });
    log.info("imports.photo_check_done", {
      total: stored.total,
      checked: stored.checked,
      problems: problems.length,
      limit: PHOTO_CHECK_LIMITS.maxLinks,
    });
    return toState(stored, {
      reused: false,
      minutesAgo: 0,
      retryAfterSeconds: REUSE_MINUTES * 60,
    });
  } catch (error) {
    reportActionError("imports.photo_check", error);
    // La revisión empezada queda registrada como fallida (no se queda «en curso»).
    if (started) {
      try {
        const { supabase } = await storeClient(storeHandle);
        await callRpc(supabase, "imports_photo_check_finish", {
          p_store_id: started.storeId,
          p_check_id: started.checkId,
          p_result: null,
          p_error: error instanceof Error ? error.name.slice(0, 100) : "error",
        });
      } catch (finishError) {
        reportActionError("imports.photo_check_finish", finishError);
      }
    }
    return { state: "error", message: "No pudimos revisar las fotos. Inténtalo de nuevo." };
  }
}
