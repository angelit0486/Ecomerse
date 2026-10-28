import { z } from "zod";

/**
 * Salud de la plataforma (misión vendible F1.6): forma de `platform_health()` y
 * textos en español de cada problema. La base decide los umbrales; aquí solo se
 * explican (docs/runbooks/salud-y-alertas.md).
 */
export const healthSchema = z.object({
  checked_at: z.string(),
  status: z.enum(["ok", "warning", "critical"]),
  issues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["warning", "critical"]),
      value: z.number(),
    }),
  ),
  queue: z.object({
    oldest_ready_seconds: z.number(),
    stuck: z.number(),
    dead_24h: z.number(),
    dead_by_type: z.record(z.string(), z.number()),
  }),
  payments: z.object({
    events_24h: z.number(),
    events_failed_24h: z.number(),
    webhooks_rejected_24h: z.number(),
    open_over_2h: z.number(),
  }),
  emails: z.object({ sent_24h: z.number(), suppressed_24h: z.number() }),
  orders_24h: z.number(),
});

export type Health = z.infer<typeof healthSchema>;
export type HealthIssue = Health["issues"][number];

/** Qué pasa y qué hacer, en una línea, para cada problema conocido. */
export function describeIssue(issue: HealthIssue): { title: string; action: string } {
  switch (issue.code) {
    case "queue_stalled":
      return {
        title: `La cola de trabajos lleva ${issue.value} min detenida`,
        action:
          "Revisa que el cron de trabajos esté activo en Vercel (CRON_SECRET) y que la base responda.",
      };
    case "jobs_stuck":
      return {
        title: `${issue.value} trabajo(s) atorado(s) más de 15 minutos`,
        action: "Suele ser un despliegue cortado: se liberan solos; si siguen, revisa los logs.",
      };
    case "payment_events":
      return {
        title: `${issue.value} aviso(s) de pago con error en 24 h`,
        action:
          "Revisa los pedidos en atención: un pago pudo no aplicarse. La reconciliación reintenta cada 10 min.",
      };
    case "jobs_dead":
      return {
        title: `${issue.value} trabajo(s) fallido(s) en 24 h`,
        action: "Ábrelos en Consola → Trabajos y reintenta cuando el problema esté resuelto.",
      };
    case "webhook_rejected":
      return {
        title: `${issue.value} aviso(s) de pago rechazados en 24 h`,
        action:
          "Puede ser una clave secreta del webhook equivocada o intentos falsos. Revisa la configuración del proveedor.",
      };
    case "payments_stale":
      return {
        title: `${issue.value} pago(s) en línea abiertos hace más de 2 h`,
        action:
          "La reconciliación debería cerrarlos; si no, revisa las credenciales del proveedor.",
      };
    default:
      return { title: `Problema: ${issue.code}`, action: "Revisa Consola → Salud." };
  }
}
