import Link from "next/link";

import { GOAL_KEY } from "@/lib/catalog/attributes";
import type { ProductAttribute } from "@/server/storefront/catalog";

/**
 * Atributos del producto en su ficha (R-T04). Se muestran como datos, sin
 * aspecto de botón: en una ficha, un chip «Vainilla» parece un selector de
 * sabor y sacaba al listado (revisión de conversión, M4). Solo los objetivos
 * llevan un enlace explícito al catálogo filtrado, de al menos 44 px de alto.
 */
export function ProductAttributes({ attributes }: { attributes: ProductAttribute[] }) {
  if (attributes.length === 0) return null;
  const goals = attributes.find((a) => a.key === GOAL_KEY && a.filterable);
  return (
    <div className="space-y-2 text-sm">
      <dl className="space-y-1">
        {attributes.map((attribute) => (
          <div key={attribute.key} className="flex flex-wrap gap-x-1">
            <dt className="font-medium">{attribute.name}:</dt>
            <dd>{attribute.values.map((value) => value.label).join(", ")}</dd>
          </div>
        ))}
      </dl>
      {goals ? (
        <ul className="flex flex-wrap gap-x-4">
          {goals.values.map((value) => (
            <li key={value.key}>
              <Link
                href={`/productos?${new URLSearchParams([[GOAL_KEY, value.key]])}`}
                className="inline-flex min-h-11 items-center font-semibold text-[var(--sf-link)] underline underline-offset-4"
              >
                Ver más para {value.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
