import Link from "next/link";

/**
 * 404 del panel, la consola y el acceso (fuera de una tienda; la tienda tiene la
 * suya). Antes se veía la página por defecto de Next.js, en inglés. Sin marca de
 * la plataforma (white-label).
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-16">
      <p aria-hidden="true" className="text-6xl font-bold tracking-tight text-fg-muted">
        404
      </p>
      <h1 className="text-2xl font-semibold">No encontramos esta página</h1>
      <p className="text-fg-muted">El enlace puede estar incompleto o la página ya no existe.</p>
      <p>
        {/* «/» lleva al inicio correcto en cada dominio (panel o tienda). */}
        <Link href="/" className="font-medium underline underline-offset-4">
          Ir al inicio
        </Link>
      </p>
    </main>
  );
}
