import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { requirePlatformRole } from "@/server/auth/platform";
import { PruvaLogo } from "@/ui/brand/pruva-logo";
import { Button } from "@/ui/primitives/button";

export const metadata: Metadata = { title: { default: "Plataforma", template: "%s · Plataforma" } };

// 44 px en el celular y 36 px en escritorio, como el resto del panel.
const navLink = "inline-flex min-h-11 items-center sm:min-h-9";

const ROLE: Record<string, string> = {
  platform_owner: "Dueño de la plataforma",
  platform_admin: "Administración",
  platform_support: "Soporte",
};

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const role = await requirePlatformRole();
  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
        <nav
          aria-label="Consola de plataforma"
          className="flex flex-wrap items-center gap-x-4 text-sm"
        >
          <span className="flex items-center gap-2 font-semibold">
            <PruvaLogo title="PRUVA" className="h-6 w-auto text-accent" />
            Consola
          </span>
          <Link href="/platform" className={navLink}>
            Organizaciones
          </Link>
          <Link href="/platform/planes" className={navLink}>
            Planes
          </Link>
          <Link href="/platform/soporte" className={navLink}>
            Soporte
          </Link>
          <Link href="/platform/cumplimiento" className={navLink}>
            Cumplimiento
          </Link>
          <Link href="/platform/trabajos" className={navLink}>
            Trabajos
          </Link>
          <Link href="/platform/salud" className={navLink}>
            Salud
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-[13px] text-fg-muted">
          <span>{ROLE[role]}</span>
          <form action="/salir" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Salir
            </Button>
          </form>
        </div>
      </header>
      <main data-panel className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
