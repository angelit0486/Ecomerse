import Link from "next/link";
import type { ReactNode } from "react";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

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
    { href: `${base}/inventario`, label: "Inventario", show: hasPermission(ctx, "inventory.read") },
    { href: `${base}/ajustes/equipo`, label: "Equipo", show: hasPermission(ctx, "staff.read") },
  ].filter((item) => item.show);

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="md:w-56 md:shrink-0">
        <details className="mb-4 rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
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
        <nav aria-label="Secciones de la tienda">
          <ul className="space-y-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded px-3 py-1.5 text-sm hover:bg-canvas"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
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
