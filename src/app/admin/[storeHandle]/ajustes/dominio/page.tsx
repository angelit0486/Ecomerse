import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { AddDomainForm, DnsRecords, DomainActions } from "./domain-forms";

export const metadata: Metadata = { title: "Dominio" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ hecho?: string }>;
};

const DONE: Record<string, string> = {
  principal: "Listo: tu tienda abre con tu dominio y la dirección de la plataforma lo redirige.",
  quitado: "Dominio quitado. Tu tienda vuelve a abrir con la dirección de la plataforma.",
};

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Activo", tone: "text-success" },
  pending: { label: "Pendiente de conectar", tone: "text-fg-muted" },
  verifying: { label: "Verificando", tone: "text-fg-muted" },
  failed: { label: "Con error: revisa el registro DNS", tone: "text-danger" },
  removed: { label: "Quitado", tone: "text-fg-muted" },
};

/**
 * Dominio (misión panel, F2; E16): dónde vive hoy la tienda y su dominio propio.
 * Agregar, verificar (TXT de propiedad + proveedor, por el worker), hacerlo
 * principal y quitarlo.
 */
export default async function DomainPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const done = DONE[(await searchParams).hecho ?? ""];
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("store_domains")
    .select("id, hostname, type, status, is_primary")
    .eq("store_id", ctx.store.id)
    .neq("status", "removed")
    .order("is_primary", { ascending: false })
    .order("hostname");
  if (error) throw error;
  const domains = (data ?? []) as {
    id: string;
    hostname: string;
    type: "platform_subdomain" | "custom";
    status: string;
    is_primary: boolean;
  }[];
  const primary = domains.find((d) => d.is_primary && d.status === "active");
  const custom = domains.filter((d) => d.type === "custom");
  const hasCustom = custom.length > 0;
  const canManage = hasPermission(ctx, "domains.manage");
  const env = serverEnv();
  const targets = { cname: env.DOMAIN_CNAME_TARGET ?? null, apexA: env.DOMAIN_APEX_A ?? null };

  return (
    <section className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Dominio</h1>
        <p className="text-sm text-fg-muted">
          La dirección con la que tus clientes abren tu tienda.
        </p>
      </header>

      {done ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          {done}
        </p>
      ) : null}

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

      <section aria-labelledby="dominio-propio" className="space-y-3">
        <h2 id="dominio-propio" className="font-semibold">
          {hasCustom
            ? "Tu dominio propio"
            : "Usar tu propio dominio (por ejemplo, www.tutienda.mx)"}
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Compra el dominio en un registrador: Akky para dominios .mx, o GoDaddy, Namecheap y
            similares.
          </li>
          <li>Escríbelo aquí abajo. Te diremos los registros DNS exactos que debes agregar.</li>
          <li>
            Agrega esos registros en tu registrador. Revisamos solos cada pocos minutos durante 3
            días y luego una vez al día por 2 semanas.
          </li>
          <li>
            Cuando diga <strong>Activo</strong>, elige «Usar como principal»: tu tienda abre con tu
            dominio y la dirección de la plataforma lo redirige.
          </li>
        </ol>
        <p className="text-[13px] text-fg-muted">
          El cambio de DNS puede tardar algunas horas en verse en todo el mundo.
        </p>
        {canManage ? (
          <>
            {custom.map((d) => (
              <div key={d.id} className="space-y-3 rounded-md border border-border p-3">
                <p className="text-sm">
                  <strong className="break-all">{d.hostname}</strong> ·{" "}
                  <span className={STATUS[d.status]?.tone}>
                    {STATUS[d.status]?.label ?? d.status}
                  </span>
                </p>
                {d.status === "failed" ? (
                  <p className="text-[13px] text-danger">
                    Pasaron 2 semanas sin encontrar los registros. Revísalos, genera un código nuevo
                    y vuelve a verificar.
                  </p>
                ) : null}
                {["pending", "verifying", "failed"].includes(d.status) ? (
                  <DnsRecords hostname={d.hostname} token={null} targets={targets} />
                ) : null}
                <DomainActions storeHandle={ctx.store.handle} domain={d} targets={targets} />
              </div>
            ))}
            {custom.length < 2 ? (
              <AddDomainForm storeHandle={ctx.store.handle} targets={targets} />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            Los dominios los conecta quien administra la tienda.
          </p>
        )}
      </section>
    </section>
  );
}
