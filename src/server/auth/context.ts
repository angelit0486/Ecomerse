import { z } from "zod";

import { AppError } from "@/server/errors";

import { isStorePermission, type StorePermission } from "./permissions";

/**
 * Contexto de autorización de una tienda (GATE0 §7.2): lo devuelve la RPC
 * `access_store_context` en cada request. Los permisos se evalúan en vivo en la
 * base; aquí solo se validan y se exponen tipados.
 */
const storeContextSchema = z.object({
  user_id: z.uuid(),
  store: z.object({
    id: z.uuid(),
    organization_id: z.uuid(),
    name: z.string(),
    handle: z.string(),
    status: z.enum(["draft", "active", "paused", "suspended", "closed"]),
    currency: z.string().length(3),
    locale: z.string(),
    timezone: z.string(),
  }),
  org_role: z.enum(["org_owner", "org_admin", "org_member"]).nullable(),
  access_mode: z.enum(["full", "read_only", "suspended"]),
  support_grant_id: z.uuid().nullable(),
  permissions: z.array(z.string()),
});

export interface StoreContext {
  userId: string;
  store: z.infer<typeof storeContextSchema>["store"];
  orgRole: "org_owner" | "org_admin" | "org_member" | null;
  accessMode: "full" | "read_only" | "suspended";
  /** Presente cuando el acceso es una concesión de soporte (solo lectura). */
  supportGrantId: string | null;
  permissions: ReadonlySet<StorePermission>;
}

export function parseStoreContext(raw: unknown): StoreContext {
  const parsed = storeContextSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("internal", undefined, { cause: parsed.error });
  const { data } = parsed;
  return {
    userId: data.user_id,
    store: data.store,
    orgRole: data.org_role,
    accessMode: data.access_mode,
    supportGrantId: data.support_grant_id,
    // Un permiso desconocido para el código se ignora (denegado por defecto).
    permissions: new Set(data.permissions.filter(isStorePermission)),
  };
}

export function hasPermission(ctx: StoreContext, permission: StorePermission): boolean {
  return ctx.permissions.has(permission);
}

/** Lanza `forbidden` si el contexto no incluye el permiso. */
export function requirePermission(ctx: StoreContext, permission: StorePermission): void {
  if (!hasPermission(ctx, permission)) throw new AppError("forbidden");
}
