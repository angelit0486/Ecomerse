import Link from "next/link";

import { requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { describeIssue, healthSchema, type Health } from "@/lib/platform/health";

export const metadata = { title: "Salud" };
// Siempre al momento: es lo primero que se abre cuando llega un aviso.
export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});

const STATUS: Record<Health["status"], { label: string; detail: string; tone: string }> = {
  ok: {
    label: "Todo en orden",
    detail: "La cola avanza, los pagos se aplican y no hay fallas recientes.",
    tone: "border-success/40 bg-success/10",
  },
  warning: {
    label: "Hay avisos",
    detail: "Nada está detenido, pero algo necesita revisión hoy.",
    tone: "border-warning/50 bg-warning/10",
  },
  critical: {
    label: "Atención urgente",
    detail: "Algo está detenido o falló: puede afectar pedidos o pagos de las tiendas.",
    tone: "border-danger/50 bg-danger/10",
  },
};

function minutes(seconds: number) {
  if (seconds < 60) return "al día";
  return `${Math.floor(seconds / 60)} min`;
}

/**
 * Salud de la plataforma (misión vendible F1.6). Solo conteos: nunca payloads,
 * correos ni datos de compradores. Los mismos problemas llegan por correo a
 * dueño y administración (docs/runbooks/salud-y-alertas.md).
 */
export default async function HealthPage() {
  await requirePlatformRole();
  const supabase = await createSupabaseServerClient();
  const health = healthSchema.parse(await callRpc(supabase, "platform_health"));
  const status = STATUS[health.status];
  const deadTypes = Object.entries(health.queue.dead_by_type);

  const groups: { title: string; rows: [string, string | number][] }[] = [
    {
      title: "Cola de trabajos",
      rows: [
        ["Trabajo listo más antiguo", minutes(health.queue.oldest_ready_seconds)],
        ["Atorados (más de 15 min)", health.queue.stuck],
        ["Fallidos en 24 h", health.queue.dead_24h],
      ],
    },
    {
      title: "Pagos (24 h)",
      rows: [
        ["Avisos de pago recibidos", health.payments.events_24h],
        ["Avisos con error", health.payments.events_failed_24h],
        ["Avisos rechazados por firma", health.payments.webhooks_rejected_24h],
        ["Pagos abiertos más de 2 h", health.payments.open_over_2h],
        ["Contracargos y reembolsos externos", health.payments.reversals_24h ?? 0],
      ],
    },
    {
      title: "Correos y pedidos (24 h)",
      rows: [
        ["Correos enviados", health.emails.sent_24h],
        ["Correos no enviados (rebote o baja)", health.emails.suppressed_24h],
        ["Pedidos nuevos", health.orders_24h],
      ],
    },
  ];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Salud de la plataforma</h1>
        <p className="text-sm text-fg-muted">
          Revisada el {when.format(new Date(health.checked_at))}. Se revisa sola cada 15 minutos y
          avisa por correo a dueño y administración si algo falla.
        </p>
      </header>

      <div role="status" className={`rounded-md border p-4 ${status.tone}`}>
        <p className="font-semibold">{status.label}</p>
        <p className="text-sm">{status.detail}</p>
      </div>

      {health.issues.length > 0 ? (
        <section aria-labelledby="problemas" className="space-y-3">
          <h2 id="problemas" className="text-base font-semibold">
            Qué revisar
          </h2>
          <ul className="space-y-3">
            {health.issues.map((issue) => {
              const { title, action } = describeIssue(issue);
              return (
                <li key={issue.code} className="rounded-md border border-border bg-surface p-4">
                  <p className="font-medium">
                    {issue.severity === "critical" ? "Urgente: " : "Aviso: "}
                    {title}
                  </p>
                  <p className="text-sm text-fg-muted">{action}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {groups.map((g) => (
          <section key={g.title} className="rounded-md border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">{g.title}</h2>
            <dl className="space-y-1 text-sm">
              {g.rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className="font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      {deadTypes.length > 0 ? (
        <p className="text-sm text-fg-muted">
          Fallidos por tipo: {deadTypes.map(([t, n]) => `${t} (${n})`).join(", ")}.{" "}
          <Link href="/platform/trabajos" className="underline">
            Ver y reintentar en Trabajos
          </Link>
        </p>
      ) : null}
    </section>
  );
}
