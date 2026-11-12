"use server";

import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { hasPermission } from "@/server/auth/context";
import { serverEnv } from "@/server/env";
import {
  checkPhotoLinks,
  displayLink,
  PHOTO_CHECK_LABELS,
  type PhotoCheckStatus,
  type PhotoLink,
} from "@/server/imports/photo-check";

import { storeClient } from "../../_shared/action-state";

/**
 * Revisar los enlaces de fotos de una importación antes de confirmarla (Orden 10,
 * O10-04). Solo lee el plan (con RLS) y consulta los enlaces con el descargador
 * seguro; no cambia nada en la base.
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
    };

const uuid = z.uuid();
const SHOWN = 200;
const PAGE = 1000;
// Una revisión por importación cada pocos segundos (por instancia): evita que
// un doble clic dispare cientos de descargas dos veces.
const COOLDOWN_MS = 15_000;
const recent = new Map<string, number>();

export async function checkImportPhotos(
  storeHandle: string,
  jobId: string,
): Promise<PhotoCheckState> {
  if (!uuid.safeParse(jobId).success) return { state: "error", message: "Importación no válida." };
  try {
    const { ctx, supabase, storeId } = await storeClient(storeHandle);
    if (!hasPermission(ctx, "imports.run") || !hasPermission(ctx, "products.update")) {
      return { state: "error", message: "Tu rol no puede revisar las fotos de esta importación." };
    }
    const last = recent.get(jobId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) {
      return { state: "error", message: "Espera unos segundos antes de revisar otra vez." };
    }
    recent.set(jobId, Date.now());
    for (const [key, at] of recent) if (Date.now() - at > COOLDOWN_MS) recent.delete(key);

    const links: PhotoLink[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("import_job_rows")
        .select("row_number, normalized")
        .eq("store_id", storeId)
        .eq("import_job_id", jobId)
        .not("normalized->images", "is", null)
        .order("row_number")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of (data ?? []) as {
        row_number: number;
        normalized: { handle?: unknown; images?: unknown } | null;
      }[]) {
        const images = Array.isArray(row.normalized?.images) ? row.normalized.images : [];
        const handle = typeof row.normalized?.handle === "string" ? row.normalized.handle : "";
        for (const url of images) {
          if (typeof url === "string") links.push({ url, row: row.row_number, handle });
        }
      }
      if (!data || data.length < PAGE) break;
    }
    if (links.length === 0) {
      return { state: "error", message: "Este archivo no trae enlaces de fotos." };
    }

    const testOrigin = serverEnv().REMOTE_FETCH_TEST_ORIGIN;
    const result = await checkPhotoLinks(links, testOrigin ? { testOrigin } : {});
    return {
      state: "done",
      total: result.total,
      checked: result.checked,
      ok: result.counts.ok,
      problems: result.problems.slice(0, SHOWN).map((p) => ({
        row: p.row,
        handle: p.handle,
        link: displayLink(p.url),
        status: p.status,
        label: PHOTO_CHECK_LABELS[p.status as Exclude<PhotoCheckStatus, "ok">],
      })),
      more: Math.max(0, result.problems.length - SHOWN),
    };
  } catch (error) {
    reportActionError("imports.photo_check", error);
    return { state: "error", message: "No pudimos revisar las fotos. Inténtalo de nuevo." };
  }
}
