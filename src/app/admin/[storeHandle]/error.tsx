"use client";

import { ErrorPanel } from "@/ui/primitives/error-panel";

/**
 * Error dentro de una tienda: a diferencia de `admin/error.tsx`, conserva el menú
 * (el layout de la tienda sigue montado) para que la dueña pueda ir a otra sección.
 */
export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel digest={error.digest} reset={reset} />;
}
