import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Última migración que este código necesita (misión Panel, Paso E). Se
 * actualiza junto con `public.app_schema_version()` en cada migración nueva.
 */
export const EXPECTED_SCHEMA_VERSION = "20261028000400";

export type SchemaStatus = { ok: true } | { ok: false; current: string | null };

/**
 * ¿La base tiene todas las migraciones que espera el código? Si la función no
 * existe (base anterior a esta revisión), `current` es null. Ante un error de
 * red no se avisa nada: no es falta de migraciones.
 */
export async function checkSchemaVersion(supabase: SupabaseClient): Promise<SchemaStatus> {
  const { data, error } = await supabase.rpc("app_schema_version");
  if (error) {
    // PGRST202: la función no existe; 42883: no existe en Postgres.
    const missing = error.code === "PGRST202" || error.code === "42883";
    return missing ? { ok: false, current: null } : { ok: true };
  }
  return compareSchemaVersion(typeof data === "string" ? data : null);
}

export function compareSchemaVersion(current: string | null): SchemaStatus {
  if (!current || !/^\d{14}$/.test(current)) return { ok: false, current: null };
  return current >= EXPECTED_SCHEMA_VERSION ? { ok: true } : { ok: false, current };
}
