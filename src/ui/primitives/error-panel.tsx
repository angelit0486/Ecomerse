"use client";

import { Button } from "./button";

/**
 * Pantalla de error del panel, la consola y el acceso (error boundary de Next).
 * Antes se veía la página por defecto, en inglés y sin salida. El código de
 * referencia (digest) es el del registro del servidor; nunca se muestra el
 * mensaje interno (puede llevar datos).
 */
export function ErrorPanel({ digest, reset }: { digest?: string; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col gap-4 py-16">
      <h1 className="text-2xl font-semibold">Algo falló al cargar esta pantalla</h1>
      <p className="text-fg-muted">
        No se perdió nada de lo que guardaste. Vuelve a intentarlo; si sigue pasando, comparte el
        código de referencia con soporte.
      </p>
      {digest ? (
        <p className="text-sm text-fg-muted">
          Código de referencia: <code>{digest}</code>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={reset}>
          Reintentar
        </Button>
        <a href="." className="inline-flex items-center text-sm font-medium underline">
          Volver
        </a>
      </div>
    </div>
  );
}
