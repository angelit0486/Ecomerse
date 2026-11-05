import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { findGuide } from "@/lib/help/guides";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../../_shared/panel-flags";

type Props = { params: Promise<{ storeHandle: string; guia: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: findGuide((await params).guia)?.title ?? "Ayuda" };
}

/** Una guía de la ayuda del panel (interruptor panel_help). */
export default async function HelpGuidePage({ params }: Props) {
  const { storeHandle, guia } = await params;
  const guide = findGuide(guia);
  if (!guide) notFound();
  const ctx = await getStoreContextForPage(storeHandle);
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "panel_help"))) notFound();
  const base = `/admin/${ctx.store.handle}`;
  return (
    <article className="max-w-2xl space-y-5">
      <Link href={`${base}/ayuda`} className="inline-flex min-h-11 items-center text-sm underline">
        ← Ayuda
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{guide.title}</h1>
        <p className="text-sm text-fg-muted">{guide.summary}</p>
      </header>
      <ol className="list-decimal space-y-3 pl-5">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.tips?.length ? (
        <section
          aria-labelledby="consejos"
          className="space-y-2 rounded-lg border border-border p-4"
        >
          <h2 id="consejos" className="font-semibold">
            Consejos
          </h2>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {guide.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <Link
        href={`${base}${guide.path}`}
        className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
      >
        {guide.pathLabel}
      </Link>
    </article>
  );
}
