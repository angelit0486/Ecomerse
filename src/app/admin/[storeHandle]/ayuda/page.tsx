import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HELP_GUIDES } from "@/lib/help/guides";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../_shared/panel-flags";

export const metadata: Metadata = { title: "Ayuda" };

type Props = { params: Promise<{ storeHandle: string }> };

/** Ayuda del panel (interruptor panel_help): guías paso a paso. */
export default async function HelpPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "panel_help"))) notFound();
  const base = `/admin/${ctx.store.handle}/ayuda`;
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Ayuda</h1>
        <p className="text-sm text-fg-muted">
          Guías cortas para las tareas de todos los días. Cada una te lleva a la pantalla donde se
          hace.
        </p>
      </header>
      <ul aria-label="Guías" className="grid max-w-3xl gap-3 sm:grid-cols-2">
        {HELP_GUIDES.map((g) => (
          <li key={g.slug}>
            <Link
              href={`${base}/${g.slug}`}
              className="block h-full space-y-1 rounded-lg border border-border p-4 hover:bg-canvas"
            >
              <span className="block font-semibold underline-offset-2">{g.title}</span>
              <span className="block text-sm text-fg-muted">{g.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
