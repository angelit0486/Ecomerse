"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mientras la tienda no está publicada, cada pantalla a la que lleva «Configura
 * tu tienda» (productos, envíos, impuestos, políticas…) ofrece volver a la guía:
 * así la dueña no se pierde a la mitad del recorrido. No aparece en la guía ni en
 * el Inicio, que ya la muestran.
 */
export function LaunchGuideReturn({ base }: { base: string }) {
  const path = usePathname();
  const guide = `${base}/configuracion`;
  if (path === base || path === guide || path.startsWith(`${guide}/`)) return null;
  return (
    <p className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <span className="text-fg-muted">Tu tienda aún no está publicada.</span>
      <Link
        href={guide}
        className="inline-flex min-h-11 items-center font-medium underline md:min-h-0"
      >
        Volver a «Configura tu tienda»
      </Link>
    </p>
  );
}
