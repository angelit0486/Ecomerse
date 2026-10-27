"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * En la página de pago, encabezado mínimo (logo, «Pago seguro» y regresar al
 * carrito) en lugar del buscador, el menú y la barra de categorías: menos
 * salidas mientras se paga (auditoría UX-12). Ambas versiones las arma el
 * servidor; aquí solo se elige cuál mostrar según la ruta.
 */
export function CheckoutChrome({ checkout, regular }: { checkout: ReactNode; regular: ReactNode }) {
  const pathname = usePathname();
  return <>{isCheckoutPath(pathname) ? checkout : regular}</>;
}

export function isCheckoutPath(pathname: string | null): boolean {
  return pathname === "/checkout" || (pathname?.startsWith("/checkout/") ?? false);
}
