/**
 * Espejo en TypeScript del catálogo de permisos (GATE0 §8.2). Fuente de verdad:
 * la tabla `public.permissions`. `tests/integration/permissions-sync.test.ts`
 * falla si difieren.
 *
 * Solo sirve para tipar y para decidir qué mostrar en la UI: la autorización
 * real ocurre siempre en la base (app.has_store_permission).
 */
export const STORE_PERMISSIONS = [
  "analytics.read",
  "appearance.manage",
  "audit.read",
  "brands.manage",
  "categories.manage",
  "content.manage",
  "customers.delete",
  "customers.pii.read",
  "customers.read",
  "customers.update",
  "discounts.manage",
  "discounts.read",
  "domains.manage",
  "exports.run",
  "imports.run",
  "inventory.adjust",
  "inventory.locations.manage",
  "inventory.read",
  "notifications.manage",
  "orders.cancel",
  "orders.fulfill",
  "orders.read",
  "orders.refund",
  "orders.update",
  "payments.manage",
  "payments.read",
  "products.cost.read",
  "products.create",
  "products.delete",
  "products.publish",
  "products.read",
  "products.update",
  "seo.manage",
  "shipping.manage",
  "staff.manage",
  "staff.read",
  "store.read",
  "store.update",
  "taxes.manage",
] as const;

export const ORG_PERMISSIONS = [
  "org.billing.manage",
  "org.billing.read",
  "org.delete",
  "org.members.manage",
  "org.read",
  "org.stores.create",
  "org.transfer_ownership",
  "org.update",
] as const;

export type StorePermission = (typeof STORE_PERMISSIONS)[number];
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

const storePermissionSet: ReadonlySet<string> = new Set(STORE_PERMISSIONS);

export function isStorePermission(value: string): value is StorePermission {
  return storePermissionSet.has(value);
}
