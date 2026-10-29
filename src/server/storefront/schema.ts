import "server-only";

import { cache } from "react";

import { gatewayDb } from "@/server/db/role-clients";
import { compareSchemaVersion, type SchemaStatus } from "@/server/db/schema-version";

/**
 * ¿La base tiene las migraciones que espera la tienda? Si faltan, el marco de la
 * tienda muestra «Tienda en mantenimiento» en vez de una pantalla rota. Una
 * función que no existe (42883) cuenta como migraciones faltantes; un error de
 * red no (no es falta de migraciones). Memoizada por request.
 */
export async function readStorefrontSchema(
  query: () => Promise<string | null>,
): Promise<SchemaStatus> {
  try {
    return compareSchemaVersion(await query());
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return code === "42883" ? { ok: false, current: null } : { ok: true };
  }
}

export const storefrontSchemaStatus = cache(() =>
  readStorefrontSchema(async () => {
    const [row] = await gatewayDb()<
      { v: string | null }[]
    >`select storefront.schema_version() as v`;
    return row?.v ?? null;
  }),
);
