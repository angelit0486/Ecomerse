import { z } from "zod";

/**
 * Registro de claves de los planes (GATE0 §19.2), espejo de `app.entitlement_type`.
 * Los límites numéricos se piden todos al guardar un plan: en la base una clave
 * ausente vale 0 y bloquearía sin querer (§19.3).
 */
export const LIMIT_KEYS = [
  "max_stores",
  "max_products",
  "max_variants_per_product",
  "max_staff",
  "max_locations",
  "max_custom_domains",
  "storage_mb",
] as const;

export const FEATURE_KEYS = [
  "custom_domains",
  "remove_platform_branding",
  "advanced_analytics",
  "abandoned_cart",
  "custom_roles",
  "api_access",
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const LIMIT_LABELS: Record<LimitKey, string> = {
  max_stores: "Tiendas",
  max_products: "Productos",
  max_variants_per_product: "Presentaciones por producto",
  max_staff: "Personas del equipo",
  max_locations: "Almacenes",
  max_custom_domains: "Dominios propios",
  storage_mb: "Espacio para fotos (MB)",
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  custom_domains: "Dominio propio",
  remove_platform_branding: "Sin la marca de la plataforma",
  advanced_analytics: "Estadísticas avanzadas",
  abandoned_cart: "Carritos abandonados",
  custom_roles: "Roles a la medida",
  api_access: "Acceso por API",
};

/** Límites con uso medido en vivo (`app.current_usage`). */
export const MEASURED_KEYS: readonly LimitKey[] = [
  "max_stores",
  "max_products",
  "max_staff",
  "storage_mb",
];

export const SUBSCRIPTION_STATUS: Record<string, string> = {
  trialing: "En prueba",
  active: "Activa",
  past_due: "Pago pendiente",
  paused: "Pausada por falta de pago",
  cancelled: "Cancelada",
};

export const ACCESS_MODE: Record<string, string> = {
  full: "Acceso completo",
  read_only: "Solo lectura",
  suspended: "Sin acceso",
};

const entitlement = z.object({
  type: z.enum(["int", "bool"]),
  value: z.union([z.number(), z.boolean()]),
  used: z.number().nullable().optional(),
  override: z.boolean(),
  override_expires_at: z.string().nullable().optional(),
  override_reason: z.string().nullable().optional(),
});

export const billingSchema = z.object({
  organization_id: z.uuid(),
  access_mode: z.enum(["full", "read_only", "suspended"]),
  plan: z.object({ key: z.string(), name: z.string() }).nullable(),
  subscription: z
    .object({
      status: z.string(),
      current_period_start: z.string().optional(),
      current_period_end: z.string().optional(),
      trial_ends_at: z.string().optional(),
      grace_ends_at: z.string().optional(),
      paused_at: z.string().optional(),
      provider: z.string().optional(),
      notes: z.string().optional(),
    })
    .nullable(),
  entitlements: z.record(z.string(), entitlement),
});

export type Billing = z.infer<typeof billingSchema>;

/**
 * Fecha que importa según el estado: hasta cuándo dura la prueba, la gracia o el
 * periodo pagado. `null` si no aplica.
 */
export function keyDate(sub: Billing["subscription"]): { label: string; at: string } | null {
  if (!sub) return null;
  if (sub.status === "trialing" && sub.trial_ends_at)
    return { label: "La prueba termina", at: sub.trial_ends_at };
  if (sub.status === "past_due" && sub.grace_ends_at)
    return { label: "Paga antes de", at: sub.grace_ends_at };
  if (sub.status === "active" && sub.current_period_end)
    return { label: "Pagado hasta", at: sub.current_period_end };
  if (sub.status === "paused" && sub.paused_at)
    return { label: "Pausada desde", at: sub.paused_at };
  return null;
}

/** Porcentaje de uso (0–100) para la barra; `null` si no se mide. */
export function usagePercent(used: number | null | undefined, limit: number): number | null {
  if (used == null) return null;
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
