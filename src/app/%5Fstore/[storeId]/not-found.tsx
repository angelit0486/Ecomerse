import Link from "next/link";

/** 404 dentro de una tienda (producto, categoría o página inexistente o no publicada). */
export default function StoreNotFound() {
  return (
    <div className="mx-auto max-w-prose space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">No encontramos esta página</h1>
      <p className="text-[var(--sf-muted)]">
        Puede que el producto ya no esté disponible o que el enlace haya cambiado.
      </p>
      <Link href="/productos" className="inline-block underline underline-offset-4">
        Ver todos los productos
      </Link>
    </div>
  );
}
