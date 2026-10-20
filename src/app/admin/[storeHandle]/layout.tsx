import Link from "next/link";
import type { ReactNode } from "react";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { AdminNav } from "./_shared/admin-nav";
import { GlobalSearch } from "./_shared/global-search";
import { NoticesButton } from "./_shared/notices-button";

type Props = { children: ReactNode; params: Promise<{ storeHandle: string }> };

interface MyStore {
  store_id: string;
  name: string;
  handle: string;
}

export default async function StoreLayout({ children, params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  const supabase = await createSupabaseServerClient();
  const stores = await callRpc<MyStore[]>(supabase, "access_list_my_stores");

  const base = `/admin/${ctx.store.handle}`;
  const nav = [
    { href: base, label: "Inicio", show: true },
    {
      href: `${base}/configuracion`,
      label: "Configurar tienda",
      show:
        ctx.store.status === "draft" &&
        (hasPermission(ctx, "store.update") || hasPermission(ctx, "appearance.manage")),
    },
    { href: `${base}/productos`, label: "Productos", show: hasPermission(ctx, "products.read") },
    { href: `${base}/pedidos`, label: "Pedidos", show: hasPermission(ctx, "orders.read") },
    { href: `${base}/clientes`, label: "Clientes", show: hasPermission(ctx, "customers.read") },
    { href: `${base}/inventario`, label: "Inventario", show: hasPermission(ctx, "inventory.read") },
    { href: `${base}/descuentos`, label: "Descuentos", show: hasPermission(ctx, "discounts.read") },
    { href: `${base}/envios`, label: "Envíos", show: hasPermission(ctx, "shipping.manage") },
    { href: `${base}/impuestos`, label: "Impuestos", show: hasPermission(ctx, "taxes.manage") },
    {
      href: `${base}/apariencia`,
      label: "Apariencia",
      show: hasPermission(ctx, "appearance.manage"),
    },
    {
      href: `${base}/contenido`,
      label: "Contenido",
      show: hasPermission(ctx, "content.manage") || hasPermission(ctx, "appearance.manage"),
    },
    { href: `${base}/ajustes/equipo`, label: "Equipo", show: hasPermission(ctx, "staff.read") },
    { href: `${base}/ajustes/pagos`, label: "Pagos", show: hasPermission(ctx, "payments.manage") },
    { href: `${base}/ajustes/dominio`, label: "Dominio", show: hasPermission(ctx, "store.update") },
    {
      href: `${base}/ajustes/notificaciones`,
      label: "Notificaciones",
      show: hasPermission(ctx, "notifications.manage"),
    },
    {
      href: `${base}/ajustes/cumplimiento`,
      label: "Cumplimiento",
      show: hasPermission(ctx, "store.update") || hasPermission(ctx, "products.update"),
    },
    {
      href: `${base}/ajustes/actividad`,
      label: "Actividad",
      show: hasPermission(ctx, "audit.read"),
    },
    {
      href: `${base}/ajustes/exportar`,
      label: "Exportar",
      show: hasPermission(ctx, "exports.run"),
    },
  ].filter((item) => item.show);

  return (
    <div className="flex flex-col gap-5 md:flex-row md:gap-8">
      <aside className="md:w-56 md:shrink-0">
        <details className="mb-3 rounded-md border border-border md:mb-4">
          <summary className="flex min-h-10 cursor-pointer items-center px-3 text-sm font-medium">
            {ctx.store.name}
          </summary>
          <ul className="border-t border-border py-1" aria-label="Cambiar de tienda">
            {stores.map((s) => (
              <li key={s.store_id}>
                <Link
                  href={`/admin/${s.handle}`}
                  aria-current={s.handle === ctx.store.handle ? "page" : undefined}
                  className="block px-3 py-1.5 text-sm hover:bg-canvas"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
        <AdminNav items={nav.map(({ href, label }) => ({ href, label }))} base={base} />
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-start gap-2">
          <GlobalSearch storeHandle={ctx.store.handle} />
          <NoticesButton storeHandle={ctx.store.handle} />
        </div>
        {ctx.supportGrantId ? (
          <p role="status" className="rounded-md border border-warning px-3 py-2 text-sm">
            Acceso de soporte: solo lectura y con tiempo limitado. Todo lo que abres queda
            registrado.
          </p>
        ) : null}
        {ctx.accessMode === "read_only" ? (
          <p role="status" className="rounded-md border border-warning px-3 py-2 text-sm">
            La cuenta está en modo de solo lectura. Revisa la facturación para volver a editar.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
