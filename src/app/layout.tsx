import type { Metadata } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Plataforma", template: "%s · Plataforma" },
  // Sin sitio público todavía: no se indexa ningún entorno.
  robots: { index: false, follow: false },
};

// Panel, consola y acceso con Inter autoalojada (CSP `font-src 'self'`): misma
// tipografía en cualquier equipo. La tienda define la suya sobre `.sf-root`.
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-app",
  display: "swap",
  // Sin precarga: la tienda no la usa (tiene sus fuentes) y no debe descargarla.
  preload: false,
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Renderizado dinámico obligatorio: el nonce de CSP es por request (D-F1-02).
  await connection();
  return (
    <html lang="es" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
