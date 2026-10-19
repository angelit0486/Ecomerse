import type { ReactNode } from "react";

import { PruvaLogo } from "@/ui/brand/pruva-logo";

export default function AccessLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <PruvaLogo className="h-8 w-auto self-start text-accent" />
      {children}
    </main>
  );
}
