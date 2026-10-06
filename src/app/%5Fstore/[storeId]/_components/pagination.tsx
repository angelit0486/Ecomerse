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
    <nav aria-label="Paginación" className="flex justify-center gap-6 text-sm">
      {firstHref ? (
        <Link href={firstHref} className="underline underline-offset-4">
          Volver al inicio
        </Link>
      ) : null}
      {nextHref ? (
        <Link href={nextHref} className="underline underline-offset-4">
          Ver más productos
        </Link>
      ) : null}
    </nav>
  );
}
