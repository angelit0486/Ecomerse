import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";

export const metadata: Metadata = { title: "Exportar" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ERRORS: Record<string, string> = {
  muchas:
    "Son más de 5 000 filas: la exportación grande llegará pronto. Escríbenos si la necesitas.",
  permiso: "No pudimos generar el archivo. Revisa que tu rol permita exportar estos datos.",
};

/**
 * Ajustes → Exportar (F8-T04a, Gate F8): cada rol exporta su área (GATE0 §8.3) —
 * catálogo, inventario o pedidos— y los clientes solo la administración de la tienda.
 * Las mismas reglas que exports_rows; PII solo con customers.pii.read.
 */
export default async function ExportPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "exports.run")) notFound();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const pii = hasPermission(ctx, "customers.pii.read");
  const entities = [
    {
      key: "products",
      label: "Productos",
      hint: "Una fila por variante, con las columnas de la plantilla de importación.",
      show: hasPermission(ctx, "products.update"),
    },
    {
      key: "inventory",
      label: "Inventario",
      hint: "Existencias por ubicación.",
      show: hasPermission(ctx, "inventory.adjust"),
    },
    {
      key: "orders",
      label: "Pedidos",
      hint: pii
        ? "Incluye email, teléfono y destino."
        : "Sin datos de contacto (tu rol no los incluye).",
      show: hasPermission(ctx, "orders.update"),
    },
    {
      key: "customers",
      label: "Clientes",
      hint: pii ? "Con datos de contacto." : "Con datos enmascarados.",
      show: hasPermission(ctx, "customers.delete"),
    },
  ].filter((e) => e.show);
  const base = `/admin/${ctx.store.handle}/ajustes/exportar`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Exportar</h1>
        <p className="text-sm text-fg-muted">
          Archivos CSV para Excel u hojas de cálculo. Cada descarga queda registrada en Actividad.
        </p>
      </header>
      {error ? (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm">
          {error}
        </p>
      ) : null}
      <ul className="space-y-3">
        {entities.map((e) => (
          <li
            key={e.key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
          >
            <div>
              <p className="font-medium">{e.label}</p>
              <p className="text-sm text-fg-muted">{e.hint}</p>
            </div>
            <form method="post" action={`${base}/${e.key}`}>
              <button type="submit" className="h-9 rounded-md border border-control px-3 text-sm">
                Descargar {e.label.toLowerCase()}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
