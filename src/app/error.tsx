"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Último recurso fuera de las secciones que tienen el suyo (panel, consola,
 * acceso, páginas de la tienda): p. ej. si falla el layout de una tienda al leer
 * sus datos. Sin marca de la plataforma (white-label) y en español; antes se veía
 * la pantalla por defecto de Next, en inglés. «Reintentar» vuelve a pedir los
 * datos al servidor (`router.refresh()` + `reset()`).
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <main
      role="alert"
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-16"
    >
      <h1 className="text-2xl font-semibold">Esta página tardó en cargar</h1>
      <p className="text-fg-muted">
        Fue un problema de conexión de nuestro lado. Vuelve a intentarlo en unos segundos.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
          className="inline-flex min-h-11 items-center rounded-md border px-5 font-medium disabled:opacity-70"
        >
          {pending ? "Cargando…" : "Reintentar"}
        </button>
        {/* «/» lleva al inicio correcto en cada dominio (panel o tienda). */}
        <Link
          prefetch={false}
          href="/"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Ir al inicio
        </Link>
      </div>
      {error.digest ? (
        <p className="text-xs text-fg-muted">
          Código de referencia: <code>{error.digest}</code>
        </p>
      ) : null}
    </main>
  );
}
