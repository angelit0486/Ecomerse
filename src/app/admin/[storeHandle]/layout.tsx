import Link from "next/link";
import type { ReactNode } from "react";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { STORE_STATUS_SHORT } from "../_shared/store-status";
import { AdminNav } from "./_shared/admin-nav";
import { GlobalSearch } from "./_shared/global-search";
import { NoticesButton } from "./_shared/notices-button";

type Props = { children: ReactNode; params: Promise<{ storeHandle: string }> };

interface MyStore {
  store_id: string;
  name: string;
  handle: string;
  status: string;
}

export default async function StoreLayout({ children, params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  const supabase = await createSupabaseServerClient();
  const stores = await callRpc<MyStore[]>(supabase, "access_list_my_stores");

  const base = `/admin/${ctx.store.handle}`;
  type Entry = { href: string; label: string; show: boolean };
  const visible = (items: Entry[]) =>
    items.filter((i) => i.show).map(({ href, label }) => ({ href, label }));
  // Grupos del menú (misión panel, F4; auditoría E10). Cada entrada, con su permiso.
  const groups = [
    {
      items: visible([
        { href: base, label: "Inicio", show: true },
        {
          href: `${base}/configuracion`,
          label: "Configurar tienda",
          show:
            ctx.store.status === "draft" &&
            (hasPermission(ctx, "store.update") || hasPermission(ctx, "appearance.manage")),
        },
      ]),
    },
    {
      title: "Vender",
      items: visible([
        { href: `${base}/pedidos`, label: "Pedidos", show: hasPermission(ctx, "orders.read") },
        { href: `${base}/clientes`, label: "Clientes", show: hasPermission(ctx, "customers.read") },
        {
          href: `${base}/descuentos`,
          label: "Descuentos",
          show: hasPermission(ctx, "discounts.read"),
        },
      ]),
    },
    {
      title: "Catálogo",
      items: visible([
        {
          href: `${base}/productos`,
          label: "Productos",
          show: hasPermission(ctx, "products.read"),
        },
        {
          href: `${base}/inventario`,
          label: "Inventario",
          show: hasPermission(ctx, "inventory.read"),
        },
      ]),
    },
    {
      title: "Tienda en línea",
      items: visible([
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
        {
          href: `${base}/ajustes/dominio`,
          label: "Dominio",
          show: hasPermission(ctx, "store.update"),
        },
      ]),
    },
    {
      title: "Ajustes",
      items: visible([
        {
          href: `${base}/ajustes/pagos`,
          label: "Pagos",
          show: hasPermission(ctx, "payments.manage"),
        },
        { href: `${base}/envios`, label: "Envíos", show: hasPermission(ctx, "shipping.manage") },
        { href: `${base}/impuestos`, label: "Impuestos", show: hasPermission(ctx, "taxes.manage") },
        { href: `${base}/ajustes/equipo`, label: "Equipo", show: hasPermission(ctx, "staff.read") },
        {
          href: `${base}/ajustes/notificaciones`,
          label: "Notificaciones",
          show: hasPermission(ctx, "notifications.manage"),
        },
        {
          href: `${base}/ajustes/cumplimiento`,
          label: "Cumplimiento sanitario",
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
      ]),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5 md:flex-row md:gap-8">
      <aside className="md:w-56 md:shrink-0">
        <details className="mb-3 rounded-md border border-border md:mb-4">
          <summary className="flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1 text-sm font-medium md:min-h-10">
            {ctx.store.name}
            {stores.length > 1 ? (
              <span className="text-[12px] font-normal text-fg-muted">
                Cambiar de tienda ({stores.length})
              </span>
            ) : null}
          </summary>
          <ul className="border-t border-border py-1" aria-label="Cambiar de tienda">
            {stores.map((s) => (
              <li key={s.store_id}>
                <Link
                  href={`/admin/${s.handle}`}
                  aria-current={s.handle === ctx.store.handle ? "page" : undefined}
                  className="flex min-h-11 items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-canvas aria-[current=page]:font-semibold md:min-h-0"
                >
                  <span>{s.name}</span>
                  <span className="text-[12px] font-normal text-fg-muted">
                    {STORE_STATUS_SHORT[s.status] ?? s.status}
                  </span>
                </Link>
              </li>
            ))}
            <li className="border-t border-border">
              <Link
                href="/admin"
                className="flex min-h-11 items-center px-3 py-1.5 text-[13px] underline md:min-h-0"
              >
                Todas mis tiendas
              </Link>
            </li>
          </ul>
        </details>
        <AdminNav
          groups={groups}
          base={base}
          primary={[base, `${base}/pedidos`, `${base}/productos`]}
        />
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
