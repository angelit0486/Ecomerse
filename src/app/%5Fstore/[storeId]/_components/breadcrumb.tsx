import Link from "next/link";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    // Enlaces de 44 px de alto para el dedo; el margen negativo conserva el espacio visual.
    <nav aria-label="Ruta de navegación" className="-my-3 text-sm text-[var(--sf-muted)]">
      <ol className="flex flex-wrap gap-1">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href && index < items.length - 1 ? (
              <Link
                prefetch={false}
                href={item.href}
                className="inline-flex min-h-11 items-center hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              // Mismo alto que los enlaces: si la ruta se parte en dos líneas, el
              // margen negativo solo recorta espacio vacío y no tapa el texto.
              <span
                aria-current={index === items.length - 1 ? "page" : undefined}
                className="inline-flex min-h-11 items-center"
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
