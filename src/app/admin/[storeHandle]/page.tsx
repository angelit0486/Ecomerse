import type { Metadata } from "next";

import { getStoreContextForPage } from "@/server/auth/store-context-page";

type Props = { params: Promise<{ storeHandle: string }> };

export const metadata: Metadata = { title: "Inicio" };

const STATUS: Record<string, string> = {
  draft: "Borrador (no visible para compradores)",
  active: "Publicada",
  paused: "Pausada",
  suspended: "Suspendida",
  closed: "Cerrada",
};

const ROLE: Record<string, string> = {
  org_owner: "Dueño de la organización",
  org_admin: "Administrador de la organización",
  org_member: "Miembro",
};

export default async function StoreHomePage({ params }: Props) {
  const ctx = await getStoreContextForPage((await params).storeHandle);
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{ctx.store.name}</h1>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">Estado</dt>
          <dd className="mt-1 font-medium">{STATUS[ctx.store.status] ?? ctx.store.status}</dd>
        </div>
        <div className="rounded-md border border-border p-4">
          <dt className="text-[13px] text-fg-muted">Tu acceso</dt>
          <dd className="mt-1 font-medium">
            {ctx.supportGrantId
              ? "Soporte (solo lectura)"
              : (ROLE[ctx.orgRole ?? ""] ?? "Equipo de la tienda")}
          </dd>
        </div>
      </dl>
    </section>
  );
}
