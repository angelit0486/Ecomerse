import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";
import type { MediaBucket, StorageAdmin } from "@/server/media/storage";

/**
 * ADR-046, paso 2: después de anonimizar una tienda cerrada se borran sus
 * archivos en Storage y (cuando se apruebe ADR-055) las cuentas de Auth de sus
 * compradores que nadie más usa. La base decide qué se borra (funciones system.*, solo tiendas
 * anonimizadas); aquí solo se ejecuta con Storage/Auth Admin. Se puede repetir
 * sin efecto y nunca registra correos ni rutas.
 */
export interface PurgeDeps {
  db: Sql;
  storage: Pick<StorageAdmin, "remove">;
  /**
   * Borra la cuenta en Supabase Auth; si ya no existe, no falla. Sin ella, las
   * cuentas esperan en la cola: borrar cuentas amplía SR-1 (GATE0 §11.5) y está
   * propuesto en ADR-055, pendiente de aprobación.
   */
  deleteAuthUser?: (userId: string) => Promise<void>;
  /** Plazo de una pasada; lo que falte sigue en la siguiente. */
  deadlineMs?: number;
}

export interface PurgeResult {
  files: number;
  storesDone: number;
  accounts: number;
  accountErrors: number;
}

export async function purgeAnonymized(deps: PurgeDeps): Promise<PurgeResult> {
  const deadline = Date.now() + (deps.deadlineMs ?? 30_000);
  const result: PurgeResult = { files: 0, storesDone: 0, accounts: 0, accountErrors: 0 };

  const stores = await deps.db<{ store_id: string }[]>`
    select store_id from system.anonymized_stores_with_files(5)`;
  for (const { store_id } of stores) {
    while (Date.now() < deadline) {
      const files = await deps.db<{ bucket: MediaBucket; path: string }[]>`
        select bucket, path from system.anonymized_store_files(${store_id}::uuid, 500)`;
      if (files.length === 0) break;
      const byBucket = new Map<MediaBucket, string[]>();
      for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
      for (const [bucket, paths] of byBucket) {
        for (let i = 0; i < paths.length; i += 100) {
          await deps.storage.remove(bucket, paths.slice(i, i + 100));
        }
      }
      result.files += files.length;
    }
    const [done] = await deps.db<{ ok: boolean }[]>`
      select system.anonymized_store_files_done(${store_id}::uuid) as ok`;
    if (done?.ok) result.storesDone += 1;
  }

  if (!deps.deleteAuthUser) return result;
  const deleteAuthUser = deps.deleteAuthUser;
  const users = await deps.db<{ user_id: string }[]>`
    select user_id from system.auth_user_purge_batch(50)`;
  for (const { user_id } of users) {
    if (Date.now() >= deadline) break;
    // Se vuelve a comprobar justo antes: pudo comprar en otra tienda mientras tanto.
    const [claim] = await deps.db<{ ok: boolean }[]>`
      select system.auth_user_purge_claim(${user_id}::uuid) as ok`;
    if (!claim?.ok) continue;
    try {
      await deleteAuthUser(user_id);
      await deps.db`select system.auth_user_purge_done(${user_id}::uuid)`;
      result.accounts += 1;
    } catch {
      // Una cuenta que falla no detiene las demás; queda en la cola para la próxima pasada.
      result.accountErrors += 1;
    }
  }
  return result;
}

export function createPurgeHandlers(deps: () => PurgeDeps): Array<[string, JobHandler]> {
  return [
    [
      "privacy.purge_anonymized",
      async (_job, { log }) => {
        log.info("Limpieza de tiendas anonimizadas", { ...(await purgeAnonymized(deps())) });
      },
    ],
  ];
}
