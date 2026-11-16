import { notFound } from "next/navigation";

import { AppError } from "@/server/errors";

/**
 * Para el `catch` de una lectura de detalle: 404 solo si la base dijo que no
 * existe (`not_found`). Cualquier otro fallo (red, base, permiso) se relanza y lo
 * muestra error.tsx; así no parece que el registro se borró.
 */
export function notFoundOrThrow(error: unknown): never {
  if (error instanceof AppError && error.code === "not_found") notFound();
  throw error;
}
