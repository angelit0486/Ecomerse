import type { Sql } from "@/server/db/role-clients";
import { PermanentJobError, type JobHandler, type JobRecord } from "@/server/jobs/types";
import { variantPath, VARIANT_WIDTHS } from "@/lib/media/variants";

import { makeVariants, processImage, sniffImageMime } from "./image";
import { fetchRemoteImage, type RemoteFetchResult } from "./remote-fetch";
import {
  isMediaPath,
  isStorePrefixedPath,
  ObjectTooLargeError,
  type MediaBucket,
  type StorageAdmin,
} from "./storage";

/**
 * Worker de medios (GATE0 §25.3, SR-2). Idempotente: un medio que ya no está
 * pendiente se ignora; publicar usa upsert y borrar un objeto ausente no falla.
 * La ruta y la tienda salen siempre de la fila, nunca del payload.
 */
export interface MediaDeps {
  db: Sql;
  storage: StorageAdmin;
  /** Una imagen nueva cambia la tienda pública: invalida su caché (§21.4). */
  onPublished?: (storeId: string) => void;
  /** Descarga de fotos remotas (ADR-033); inyectable en pruebas. */
  fetchImage?: (url: string, maxBytes: number) => Promise<RemoteFetchResult>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mediaId(job: JobRecord): string {
  const value = job.payload.media_id;
  if (typeof value !== "string" || !UUID_RE.test(value))
    throw new PermanentJobError("payload.media_id inválido");
  return value;
}

export function createMediaHandlers(deps: MediaDeps): Array<[string, JobHandler]> {
  const processMedia: JobHandler = async (job, { log }) => {
    const id = mediaId(job);
    const [row] = await deps.db<
      {
        store_id: string;
        storage_path: string;
        mime_type: string;
        max_bytes: string;
        declared_bytes: string | null;
      }[]
    >`select * from system.media_for_processing(${id}::uuid)`;
    if (!row) return; // ya procesado, rechazado o borrado

    if (job.storeId && job.storeId !== row.store_id) {
      throw new PermanentJobError("La tienda del job no coincide con la del medio");
    }

    const maxBytes = Number(row.max_bytes);
    // El original no puede pesar más de lo declarado al reservar: la cuota
    // storage_mb se comprobó con ese tamaño (Gate F3).
    const declared =
      row.declared_bytes == null ? maxBytes : Math.min(maxBytes, Number(row.declared_bytes));
    let original: Buffer | null;
    try {
      original = await deps.storage.download("store-uploads", row.storage_path, declared);
    } catch (error) {
      if (error instanceof ObjectTooLargeError) {
        await reject(deps, id, row.storage_path, "too_large");
        log.info("Medio rechazado", { media_id: id, reason: "too_large" });
        return;
      }
      throw error;
    }
    if (!original) {
      await reject(deps, id, row.storage_path, "missing_file");
      log.info("Medio rechazado", { media_id: id, reason: "missing_file" });
      return;
    }

    const result = await processImage(original, row.mime_type, maxBytes);
    if (!result.ok) {
      await reject(deps, id, row.storage_path, result.reason);
      log.info("Medio rechazado", { media_id: id, reason: result.reason });
      return;
    }

    await deps.storage.upload("store-media", row.storage_path, result.data, result.mime);
    // Paso 8: las copias en varios tamaños se suben ANTES de marcarla lista, así una
    // foto lista siempre las tiene (si fallan, el job se reintenta completo).
    await uploadVariants(deps, row.storage_path, result.data, result.width);
    await deps.db`select system.media_mark_ready(${id}::uuid, ${result.width}, ${result.height},
                                                 ${result.data.length})`;
    await markVariantsDone(deps, id);
    await deps.storage.remove("store-uploads", [row.storage_path]);
    deps.onPublished?.(row.store_id);
    log.info("Medio publicado", { media_id: id, width: result.width, height: result.height });
  };

  const purgeOrphans: JobHandler = async (_job, { log }) => {
    const candidates = await deps.db<
      { kind: string; bucket: MediaBucket; path: string; media_id: string | null }[]
    >`select * from system.media_purge_candidates(200)`;

    const byBucket = new Map<MediaBucket, string[]>();
    for (const candidate of candidates) {
      // Un nombre ajeno al esquema de rutas no bloquea la purga del resto.
      if (!isStorePrefixedPath(candidate.path)) {
        log.warn("Objeto con ruta no canónica omitido en la purga", { bucket: candidate.bucket });
        continue;
      }
      // En store-media también se van sus copias en varios tamaños (paso 8); borrar
      // una que no existe no falla.
      const extra =
        candidate.bucket === "store-media"
          ? VARIANT_WIDTHS.map((w) => variantPath(candidate.path, w))
          : [];
      byBucket.set(candidate.bucket, [
        ...(byBucket.get(candidate.bucket) ?? []),
        candidate.path,
        ...extra,
      ]);
    }
    for (const [bucket, paths] of byBucket) {
      for (let i = 0; i < paths.length; i += 100)
        await deps.storage.remove(bucket, paths.slice(i, i + 100));
    }

    const rowIds = candidates.flatMap((c) => (c.media_id ? [c.media_id] : []));
    let rows = 0;
    if (rowIds.length > 0) {
      const [deleted] = await deps.db<{ count: number }[]>`
        select system.media_purge_rows(${rowIds}::uuid[]) as count`;
      rows = deleted?.count ?? 0;
    }
    const counts: Record<string, number> = {};
    for (const candidate of candidates) counts[candidate.kind] = (counts[candidate.kind] ?? 0) + 1;
    log.info("Purga de medios", { objects: candidates.length, rows, ...counts });
  };

  // Copia de una foto al duplicar un producto (tanda 5): el archivo listo se
  // copia a la ruta del medio nuevo y se procesa como una subida más.
  const copyMedia: JobHandler = async (job, ctx) => {
    const id = mediaId(job);
    const sourceId = job.payload.source_media_id;
    if (typeof sourceId !== "string" || !UUID_RE.test(sourceId))
      throw new PermanentJobError("payload.source_media_id inválido");
    const [target] = await deps.db<{ store_id: string; storage_path: string; mime_type: string }[]>`
      select store_id, storage_path, mime_type from system.media_for_processing(${id}::uuid)`;
    if (!target) return; // ya procesado, rechazado o borrado
    if (job.storeId && job.storeId !== target.store_id) {
      throw new PermanentJobError("La tienda del job no coincide con la del medio");
    }
    const [source] = await deps.db<{ store_id: string; source_path: string; max_bytes: string }[]>`
      select * from system.media_copy_source(${id}::uuid, ${sourceId}::uuid)`;
    let data: Buffer | null = null;
    if (source) {
      try {
        data = await deps.storage.download(
          "store-media",
          source.source_path,
          Number(source.max_bytes),
        );
      } catch (error) {
        if (!(error instanceof ObjectTooLargeError)) throw error;
      }
    }
    // La foto original se borró o cambió entre el duplicado y la copia.
    if (!data) {
      await reject(deps, id, target.storage_path, "missing_file");
      ctx.log.info("Copia de medio rechazada", { media_id: id, reason: "missing_file" });
      return;
    }
    await deps.storage.upload("store-uploads", target.storage_path, data, target.mime_type);
    await processMedia(job, ctx);
  };

  // Foto desde el enlace de una importación (ADR-033, GATE0 T-08). La descarga
  // aplica los controles de SSRF; lo descargado sigue el camino de una subida:
  // store-uploads → media.process (recodificación). El enlace no se registra en
  // los logs: puede llevar una firma en la consulta.
  const fetchRemote: JobHandler = async (job, ctx) => {
    const id = mediaId(job);
    const [source] = await deps.db<
      { store_id: string; storage_path: string; source_url: string; max_bytes: string }[]
    >`select * from system.media_remote_source(${id}::uuid)`;
    if (!source) return; // ya descargada, rechazada o borrada
    if (job.storeId && job.storeId !== source.store_id) {
      throw new PermanentJobError("La tienda del job no coincide con la del medio");
    }
    const download =
      deps.fetchImage ?? ((url: string, maxBytes: number) => fetchRemoteImage(url, { maxBytes }));
    const result = await download(source.source_url, Number(source.max_bytes));
    if (!result.ok) {
      // Red, tiempo o 5xx: otro intento más tarde (la cola espera entre intentos).
      if (result.retryable && job.attempts < job.maxAttempts) {
        throw new Error(`Descarga de foto remota: ${result.detail ?? result.reason}`);
      }
      await deps.db`select system.media_mark_rejected(${id}::uuid, ${result.reason})`;
      ctx.log.info("Foto remota rechazada", {
        media_id: id,
        reason: result.reason,
        detail: result.detail,
      });
      return;
    }
    const mime = sniffImageMime(result.data);
    if (!mime) {
      await deps.db`select system.media_mark_rejected(${id}::uuid, ${"unsupported_format"})`;
      ctx.log.info("Foto remota rechazada", { media_id: id, reason: "unsupported_format" });
      return;
    }
    let path: string | null;
    try {
      const [row] = await deps.db<{ path: string | null }[]>`
        select system.media_set_remote_original(${id}::uuid, ${mime}, ${result.data.length}) as path`;
      path = row?.path ?? null;
    } catch (error) {
      // Cuota de almacenamiento de la organización agotada: no se reintenta.
      if (error instanceof Error && error.message === "limit_reached") {
        await deps.db`select system.media_mark_rejected(${id}::uuid, ${"quota_exceeded"})`;
        ctx.log.info("Foto remota rechazada", { media_id: id, reason: "quota_exceeded" });
        return;
      }
      throw error;
    }
    if (!path) return;
    await deps.storage.upload("store-uploads", path, result.data, mime);
    await processMedia(job, ctx);
  };

  // Paso 8: copias para las fotos publicadas antes de que existieran. Tandas
  // pequeñas hasta el plazo del runner; el mantenimiento lo vuelve a encolar
  // mientras falten. Una foto cuyo archivo ya no está se marca igual (no hay
  // nada que copiar y la tienda no debe quedarse sin srcset por ella).
  const backfillVariants: JobHandler = async (_job, { log }) => {
    const deadline = Date.now() + 30_000;
    let done = 0;
    while (Date.now() < deadline) {
      const batch = await deps.db<
        { id: string; store_id: string; storage_path: string; width: number | null }[]
      >`select id, store_id, storage_path, width from system.media_variants_pending(10)`;
      if (batch.length === 0) break;
      for (const media of batch) {
        if (Date.now() >= deadline) break;
        // Solo rutas canónicas: otras formas no reciben copias (ni srcset en la tienda).
        if (isMediaPath(media.storage_path) && media.width) {
          const published = await deps.storage
            .download("store-media", media.storage_path, BACKFILL_MAX_BYTES)
            .catch((error: unknown) => {
              if (error instanceof ObjectTooLargeError) return null;
              throw error;
            });
          if (published) await uploadVariants(deps, media.storage_path, published, media.width);
        }
        await markVariantsDone(deps, media.id);
        deps.onPublished?.(media.store_id);
        done += 1;
      }
    }
    // Si se acabó el plazo con fotos pendientes, sigue en la próxima pasada.
    await deps.db`select system.media_backfill_requeue()`;
    log.info("Copias de fotos generadas", { media: done });
  };

  return [
    ["media.backfill_variants", backfillVariants],
    ["media.process", processMedia],
    ["media.copy", copyMedia],
    ["media.fetch_remote", fetchRemote],
    ["media.purge_orphans", purgeOrphans],
  ];
}

async function reject(deps: MediaDeps, id: string, path: string, reason: string): Promise<void> {
  await deps.db`select system.media_mark_rejected(${id}::uuid, ${reason})`;
  await deps.storage.remove("store-uploads", [path]);
}

/** Tope de lectura de un archivo ya publicado (≤ 4096 px por lado, re-codificado). */
const BACKFILL_MAX_BYTES = 50 * 1024 * 1024;

async function uploadVariants(
  deps: MediaDeps,
  path: string,
  published: Buffer,
  width: number,
): Promise<void> {
  for (const variant of await makeVariants(published, width)) {
    await deps.storage.upload(
      "store-media",
      variantPath(path, variant.width),
      variant.data,
      "image/webp",
    );
  }
}

/**
 * Marca las copias como hechas. Con una base anterior a la migración del paso 8
 * la función no existe: se ignora (la tienda simplemente no usa srcset) en vez de
 * romper la publicación de fotos mientras se aplica la migración.
 */
async function markVariantsDone(deps: MediaDeps, id: string): Promise<void> {
  try {
    await deps.db`select system.media_set_variants_done(${id}::uuid)`;
  } catch (error) {
    if ((error as { code?: string }).code !== "42883") throw error;
  }
}
