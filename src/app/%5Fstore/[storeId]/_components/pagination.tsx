import Link from "next/link";

/** Paginación por cursor: «Ver más» lleva a la página siguiente; «Volver al inicio» a la primera. */
export function Pagination({
  firstHref,
  nextHref,
}: {
  firstHref: string | null;
  nextHref: string | null;
}) {
  if (!firstHref && !nextHref) return null;
  return (
    <nav aria-label="Paginación" className="flex flex-wrap justify-center gap-3 text-sm">
      {firstHref ? (
        <Link
          prefetch={false}
          href={firstHref}
          className="inline-flex h-12 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-6 font-semibold"
        >
          Volver al inicio
        </Link>
      ) : null}
      {nextHref ? (
        <Link
          prefetch={false}
          href={nextHref}
          className="inline-flex h-12 items-center rounded-[var(--sf-radius-btn)] border-2 border-[var(--sf-primary)] px-6 font-bold text-[var(--sf-link)]"
        >
          Ver más productos
        </Link>
      ) : null}
    </nav>
  );
}
