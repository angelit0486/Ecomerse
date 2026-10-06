import "server-only";

import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/server/env";
import {
  isMediaPath,
  isStorePrefixedPath,
  ObjectTooLargeError,
  type StorageAdmin,
} from "@/server/media/storage";

/**
 * Supabase Storage Admin con service_role (lista blanca §11.5, uso #2, SR-2).
 * Solo lo usa el worker de medios: leer el original privado, publicar el
 * archivo re-codificado y borrar objetos. Nunca consulta tablas; las rutas
 * vienen de filas `media` que el worker obtuvo con funciones system.*.
 */
export function createStorageAdmin(): StorageAdmin {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada");
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  function assertMediaPath(path: string): void {
    if (!isMediaPath(path)) throw new Error("Ruta de medio inválida");
  }

  return {
    async download(bucket, path, maxBytes) {
      assertMediaPath(path);
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) {
        const status = (error as { status?: number }).status;
        if (status === 400 || status === 404 || /not.?found/i.test(error.message)) return null;
        throw error;
      }
      if (data.size > maxBytes) throw new ObjectTooLargeError();
      return Buffer.from(await data.arrayBuffer());
    },

    async upload(bucket, path, data, contentType) {
      assertMediaPath(path);
      const { error } = await client.storage.from(bucket).upload(path, data, {
        contentType,
        upsert: true, // reintentos idempotentes del worker
        cacheControl: "31536000",
      });
      if (error) throw error;
    },

    async remove(bucket, paths) {
      if (paths.length === 0) return;
      // La purga de objetos sin fila recibe rutas no canónicas: basta con que
      // empiecen por un store_id y no salgan del bucket.
      if (!paths.every(isStorePrefixedPath)) throw new Error("Ruta de medio inválida");
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) throw error;
    },
  };
}
