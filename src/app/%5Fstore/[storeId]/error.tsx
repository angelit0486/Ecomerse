"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Error al cargar una página de la tienda (p. ej. la base tardó en responder).
 * Antes se veía la pantalla por defecto de Next, en inglés y sin salida, y el
 * comprador se iba. Aquí: mensaje en español con la marca de la tienda (el layout
 * sigue montado), «Reintentar» que vuelve a pedir los datos al servidor
 * (`router.refresh()` + `reset()`; `reset()` solo repintaría el mismo error) y
 * salidas al inicio y al carrito. Nunca se muestra el mensaje interno; el código
 * de referencia (digest) es el del registro del servidor.
 */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tries, setTries] = useState(0);

  function retry() {
    setTries((n) => n + 1);
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div role="alert" className="mx-auto max-w-prose space-y-5 py-16 sm:py-24" data-store-error="">
      <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-4xl">
        Esta página tardó en cargar
      </h1>
      <p className="text-[var(--sf-muted)]">
        Fue un problema de conexión de nuestro lado, no de tu dispositivo. Tu carrito sigue
        guardado. Vuelve a intentarlo en unos segundos.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <button
          type="button"
          onClick={retry}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-11 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-medium text-[var(--sf-btn-fg)] disabled:opacity-70"
        >
          {pending ? "Cargando…" : "Reintentar"}
        </button>
        <Link
          prefetch={false}
          href="/"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Ir al inicio
        </Link>
        <Link
          prefetch={false}
          href="/carrito"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Ver mi carrito
        </Link>
      </div>
      {tries >= 2 ? (
        <p className="text-sm text-[var(--sf-muted)]">
          Si sigue sin cargar, espera un minuto y vuelve a abrir la tienda.
        </p>
      ) : null}
      {error.digest ? (
        <p className="text-xs text-[var(--sf-muted)]">
          Código de referencia: <code>{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}
