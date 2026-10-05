import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Plataforma", template: "%s · Plataforma" },
  // Sin sitio público todavía: no se indexa ningún entorno.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Renderizado dinámico obligatorio: el nonce de CSP es por request (D-F1-02).
  await connection();
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
