import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { describeCheck, sortChecks, storeHealthSchema } from "@/lib/store-health/checks";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../_shared/panel-flags";

export const metadata: Metadata = { title: "Salud de tu tienda" };

const MARK = {
  critical: { label: "Urgente", className: "border-danger" },
  warning: { label: "Revisar", className: "border-warning" },
  ok: { label: "Bien", className: "border-border" },
} as const;

/**
 * «Salud de tu tienda» (auditoría global, paso 19; interruptor store_health):
 * lo que falta o está por fallar, con un enlace a dónde se arregla.
 */
export default async function StoreHealthPage({
  params,
}: {
  params: Promise<{ storeHandle: string }>;
}) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "store_health"))) notFound();
  const health = storeHealthSchema.parse(
    await callRpc(supabase, "store_health", { p_store_id: ctx.store.id }),
  );
  const checks = sortChecks(health.checks);
  const pending = checks.filter((c) => c.status !== "ok").length;
  const base = `/admin/${ctx.store.handle}`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Salud de tu tienda</h1>
        <p role="status" className="text-sm">
          {pending === 0
            ? "Todo está en orden."
            : pending === 1
              ? "Hay 1 cosa por revisar."
              : `Hay ${pending} cosas por revisar.`}
        </p>
      </header>
      <ul aria-label="Revisiones" className="space-y-3">
        {checks.map((c) => {
          const copy = describeCheck(c);
          const mark = MARK[c.status];
          return (
            <li key={c.key} className={`space-y-1 rounded-md border p-4 text-sm ${mark.className}`}>
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{mark.label}:</span>
                <span>{copy.title}</span>
              </p>
              {copy.detail ? <p className="text-fg-muted">{copy.detail}</p> : null}
              {c.status !== "ok" && copy.path ? (
                <Link
                  href={`${base}${copy.path}`}
                  className="inline-flex min-h-11 items-center underline md:min-h-0"
                >
                  {copy.action}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
