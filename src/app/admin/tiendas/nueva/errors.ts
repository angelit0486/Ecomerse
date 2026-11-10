import type { DbErrorLike } from "@/server/db/errors";
import type { AppError } from "@/server/errors";

/**
 * ADR-038: la base decide permiso, organización y límite del plan al crear otra
 * tienda; aquí solo se traduce su error a lo que ve la dueña.
 */
export interface NewStoreState {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

export function newStoreErrorState(
  appError: AppError,
  values: Record<string, string>,
): NewStoreState {
  // «conflict» con detalle «handle» es una dirección repetida; cualquier otro
  // (p. ej. la plataforma sin dominio de tiendas) trae su propio mensaje.
  const cause = appError.cause as DbErrorLike | undefined;
  const detail = cause?.detail ?? cause?.details;
  if (appError.code === "conflict" && detail !== "handle") {
    return { error: appError.message, values };
  }
  if (appError.code === "conflict") {
    return {
      error: "Ya existe una tienda con esa dirección.",
      fields: { store_handle: "Ya existe una tienda con esa dirección. Elige otra." },
      values,
    };
  }
  if (appError.code === "limit_reached") {
    return {
      error: "Tu plan ya no permite más tiendas. Pide a la plataforma subir de plan.",
      values,
    };
  }
  if (appError.code === "forbidden") {
    return { error: "Tu rol no permite crear tiendas en esta organización.", values };
  }
  const fields: Record<string, string> = {};
  if (appError.fields && "store_name" in appError.fields) {
    fields.store_name = "Escribe un nombre de 2 a 80 caracteres.";
  }
  if (appError.fields && "store_handle" in appError.fields) {
    fields.store_handle =
      "Usa de 3 a 40 minúsculas, números o guiones (sin «--» ni palabras reservadas como «admin»).";
  }
  return { error: appError.message, ...(Object.keys(fields).length ? { fields } : {}), values };
}
