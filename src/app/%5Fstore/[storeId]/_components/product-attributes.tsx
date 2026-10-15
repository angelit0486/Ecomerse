import Link from "next/link";

import type { ProductAttribute } from "@/server/storefront/catalog";

/**
 * Atributos del producto en su ficha (R-T04). Un valor filtrable lleva al
 * catálogo filtrado por él (por ejemplo, más productos para el mismo objetivo),
 * como "chip" tocable de al menos 44 px (F9-DESIGN §15).
 */
export function ProductAttributes({ attributes }: { attributes: ProductAttribute[] }) {
  if (attributes.length === 0) return null;
  return (
    <dl className="space-y-2 text-sm">
      {attributes.map((attribute) => (
        <div key={attribute.key} className="flex flex-wrap items-center gap-2">
          <dt className="font-medium">{attribute.name}:</dt>
          {attribute.values.map((value) => (
            <dd key={value.key}>
              {attribute.filterable ? (
                <Link
                  href={`/productos?${new URLSearchParams([[attribute.key, value.key]])}`}
                  className="inline-flex min-h-11 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-4 font-medium hover:bg-[var(--sf-surface)]"
                >
                  <span className="sr-only">
                    Ver productos con {attribute.name.toLowerCase()}:{" "}
                  </span>
                  {value.label}
                </Link>
              ) : (
                <span>{value.label}</span>
              )}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}
