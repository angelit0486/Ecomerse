import Link from "next/link";

/** 404 dentro de una tienda (producto, categoría o página inexistente o no publicada). */
export default function StoreNotFound() {
  return (
    <div className="mx-auto max-w-prose space-y-5 py-16 sm:py-24">
      <p
        aria-hidden="true"
        className="text-7xl font-bold leading-none tracking-tight text-[var(--sf-border-strong)] [font-family:var(--sf-font-heading),system-ui,sans-serif] sm:text-9xl"
      >
        404
      </p>
      <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-4xl">
        No encontramos esta página
      </h1>
      <p className="text-[var(--sf-muted)]">
        Puede que el producto ya no esté disponible o que el enlace haya cambiado.
      </p>
      <p className="flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/productos" className="font-medium underline underline-offset-4">
          Ver todos los productos
        </Link>
        <Link href="/" className="underline underline-offset-4">
          Ir al inicio
        </Link>
      </p>
    </div>
  );
}
