"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Zona horaria de la tienda para las fechas que se forman en el navegador
 * (paso 16): sin ella, el servidor (UTC) y el navegador mostraban horas
 * distintas para lo mismo. Las páginas de servidor ya usan `ctx.store.timezone`.
 */
const StoreTimeZone = createContext<string | undefined>(undefined);

export function StoreTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: ReactNode;
}) {
  return <StoreTimeZone.Provider value={timeZone}>{children}</StoreTimeZone.Provider>;
}

export function useStoreTimeZone(): string | undefined {
  return useContext(StoreTimeZone);
}
