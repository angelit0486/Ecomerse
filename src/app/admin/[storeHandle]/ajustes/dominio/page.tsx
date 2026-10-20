import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Dominio" };

type Props = { params: Promise<{ storeHandle: string }> };

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Activo", tone: "text-success" },
  pending: { label: "Pendiente de conectar", tone: "text-fg-muted" },
  verifying: { label: "Verificando", tone: "text-fg-muted" },
  failed: { label: "Con error: revisa el registro DNS", tone: "text-danger" },
  removed: { label: "Quitado", tone: "text-fg-muted" },
};

/**
 * Dominio (misión panel, F2): dónde vive hoy la tienda y cómo usar un dominio
 * propio. Solo lectura: conectar un dominio propio desde el panel requiere el
 * ADR E16 (verificación DNS y proveedor); mientras tanto lo hace la plataforma.
 */
export default async function DomainPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("store_domains")
    .select("hostname, type, status, is_primary")
    .eq("store_id", ctx.store.id)
    .neq("status", "removed")
    .order("is_primary", { ascending: false })
    .order("hostname");
  if (error) throw error;
  const domains = (data ?? []) as {
    hostname: string;
    type: "platform_subdomain" | "custom";
    status: string;
    is_primary: boolean;
  }[];
  const primary = domains.find((d) => d.is_primary && d.status === "active");
  const hasCustom = domains.some((d) => d.type === "custom");

  return (
    <section className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Dominio</h1>
        <p className="text-sm text-fg-muted">
          La dirección con la que tus clientes abren tu tienda.
        </p>
      </header>

      {primary ? (
        <p className="rounded-md border border-border p-4 text-sm">
          Tu tienda está en <strong className="break-all">{primary.hostname}</strong>
          {ctx.store.status === "active" ? "." : " (se abre al público cuando la publiques)."}
        </p>
      ) : null}

      <section aria-labelledby="mis-direcciones" className="space-y-2">
        <h2 id="mis-direcciones" className="font-semibold">
          Tus direcciones
        </h2>
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {domains.map((d) => (
            <li key={d.hostname} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="break-all font-medium">{d.hostname}</span>
              <span className="text-[13px]">
                {d.type === "custom" ? "Dominio propio" : "Dirección de la plataforma"}
                {d.is_primary ? " · principal" : ""} ·{" "}
                <span className={STATUS[d.status]?.tone}>
                  {STATUS[d.status]?.label ?? d.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dominio-propio" className="space-y-2">
        <h2 id="dominio-propio" className="font-semibold">
          {hasCustom ? "Tu dominio propio" : "Usar tu propio dominio (por ejemplo, tutienda.mx)"}
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Compra el dominio en un registrador: Akky para dominios .mx, o GoDaddy, Namecheap y
            similares.
          </li>
          <li>
            Pide al equipo de la plataforma que lo conecte, con el nombre exacto del dominio. Te
            enviarán el registro DNS que debes agregar en tu registrador; no lo cambies por tu
            cuenta.
          </li>
          <li>
            Cuando aquí diga <strong>Activo</strong>, tu tienda abre con tu dominio. La dirección de
            la plataforma sigue funcionando.
          </li>
        </ol>
        <p className="text-[13px] text-fg-muted">
          El cambio de DNS puede tardar algunas horas en verse en todo el mundo.
        </p>
      </section>
    </section>
  );
}
