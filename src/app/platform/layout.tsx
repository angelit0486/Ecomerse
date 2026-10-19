import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { requirePlatformRole } from "@/server/auth/platform";
import { PruvaLogo } from "@/ui/brand/pruva-logo";
import { Button } from "@/ui/primitives/button";

export const metadata: Metadata = { title: { default: "Plataforma", template: "%s · Plataforma" } };

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
        <nav aria-label="Consola de plataforma" className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <PruvaLogo title="PRUVA" className="h-6 w-auto text-accent" />
            Consola
          </span>
          <Link href="/platform">Organizaciones</Link>
          <Link href="/platform/soporte">Soporte</Link>
          <Link href="/platform/cumplimiento">Cumplimiento</Link>
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
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
