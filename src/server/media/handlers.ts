import type { Sql } from "@/server/db/role-clients";
import { PermanentJobError, type JobHandler, type JobRecord } from "@/server/jobs/types";
import { processImage } from "./image";
import {
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
    await deps.db`select system.media_mark_ready(${id}::uuid, ${result.width}, ${result.height},
                                                 ${result.data.length})`;
    await deps.storage.remove("store-uploads", [row.storage_path]);
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
      byBucket.set(candidate.bucket, [...(byBucket.get(candidate.bucket) ?? []), candidate.path]);
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

  return [
    ["media.process", processMedia],
    ["media.purge_orphans", purgeOrphans],
  ];
}

async function reject(deps: MediaDeps, id: string, path: string, reason: string): Promise<void> {
  await deps.db`select system.media_mark_rejected(${id}::uuid, ${reason})`;
  await deps.storage.remove("store-uploads", [path]);
}
