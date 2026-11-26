import type { ReactNode } from "react";

/**
 * Íconos del menú del panel (pasada de calidad, 2026-11-26). Trazos propios de
 * 1.75 px en una caja de 24, sin dependencias. Son decorativos: el nombre de la
 * sección siempre va en texto a su lado (aria-hidden).
 */
const PATHS: Record<string, ReactNode> = {
  inicio: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  configuracion: (
    <>
      <path d="M5 6.5 6.5 8 9 5.5" />
      <path d="M5 12.5 6.5 14 9 11.5" />
      <path d="M12 7h7M12 13h7M12 19h7" />
      <circle cx="7" cy="19" r="1.5" />
    </>
  ),
  pedidos: (
    <>
      <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  clientes: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M15.5 5.8a3 3 0 0 1 0 5.4M17 14.7c1.6.5 2.8 1.9 3.4 4.3" />
    </>
  ),
  descuentos: (
    <>
      <path d="M3.5 12.2V4.5h7.7l9 9-7.7 7.7z" />
      <circle cx="8" cy="9" r="1.4" />
    </>
  ),
  productos: (
    <>
      <path d="M12 3.5 20 7.5v9L12 20.5 4 16.5v-9z" />
      <path d="M4 7.5 12 11.5 20 7.5M12 11.5v9" />
    </>
  ),
  inventario: (
    <>
      <path d="M12 4 20 8l-8 4-8-4z" />
      <path d="M4 12l8 4 8-4M4 16l8 4 8-4" />
    </>
  ),
  rentabilidad: (
    <>
      <path d="M4 19.5h16" />
      <path d="M6.5 16v-4M11 16V8.5M15.5 16v-6M20 16V5.5" />
    </>
  ),
  apariencia: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-1 .8-1.7 1.8-1.7h2.2a3.7 3.7 0 0 0 3.7-3.7C20.5 6.9 16.7 3.5 12 3.5z" />
      <circle cx="7.8" cy="11" r="1" />
      <circle cx="10.5" cy="7.3" r="1" />
      <circle cx="15" cy="7.8" r="1" />
    </>
  ),
  contenido: (
    <>
      <path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12z" />
      <path d="M13.5 3.5V8.5h5M9 12.5h6M9 16h6" />
    </>
  ),
  dominio: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z" />
    </>
  ),
  tienda: (
    <>
      <path d="M4 9.5 5.5 4.5h13L20 9.5" />
      <path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5" />
      <path d="M5.5 12v7.5h13V12M10 19.5v-4h4v4" />
    </>
  ),
  pagos: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17M7 14.5h3" />
    </>
  ),
  envios: (
    <>
      <path d="M3.5 6.5h10v9h-10z" />
      <path d="M13.5 9.5h3.5l3 3v3h-6.5" />
      <circle cx="7" cy="17.5" r="1.7" />
      <circle cx="16.5" cy="17.5" r="1.7" />
    </>
  ),
  impuestos: (
    <>
      <path d="M6 18 18 6" />
      <circle cx="7.5" cy="7.5" r="2" />
      <circle cx="16.5" cy="16.5" r="2" />
    </>
  ),
  equipo: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c.9-3.6 3.4-5.5 6.5-5.5s5.6 1.9 6.5 5.5" />
    </>
  ),
  notificaciones: (
    <>
      <path d="M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 1.5H5z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  correos: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  funciones: (
    <>
      <rect x="3.5" y="5.5" width="17" height="6" rx="3" />
      <circle cx="17.5" cy="8.5" r="1.6" />
      <rect x="3.5" y="13" width="17" height="6" rx="3" />
      <circle cx="6.5" cy="16" r="1.6" />
    </>
  ),
  cumplimiento: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  plan: (
    <>
      <path d="M12 3.5 14.5 9l6 .6-4.5 4 1.3 5.9L12 16.5l-5.3 3 1.3-5.9-4.5-4 6-.6z" />
    </>
  ),
  actividad: (
    <>
      <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" />
    </>
  ),
  exportar: (
    <>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 16v3.5h15V16" />
    </>
  ),
};

/** Ícono de la sección por el último tramo de su ruta (o «inicio» para la raíz). */
export function NavIcon({ section }: { section: string }) {
  const paths = PATHS[section];
  if (!paths) return <span aria-hidden="true" className="size-[18px] shrink-0" />;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {paths}
    </svg>
  );
}

export const hasNavIcon = (section: string) => section in PATHS;
