import Link from "next/link";
import type { ReactNode } from "react";

import { requireStaffSession } from "@/server/auth/guards";
import { Button } from "@/ui/primitives/button";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireStaffSession();
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <span className="font-semibold">Panel</span>
        <div className="flex items-center gap-2">
          <Link href="/seguridad/contrasena" className="text-sm underline">
            Contraseña
          </Link>
          <form action="/salir" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Salir
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-5 md:py-8">{children}</div>
    </div>
  );
}
