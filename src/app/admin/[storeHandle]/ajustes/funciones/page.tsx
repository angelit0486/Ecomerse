import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { visibleFeatures, type StoreFeatureRow } from "@/lib/features/store-features";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { FeatureToggle } from "./feature-toggle";

export const metadata: Metadata = { title: "Funciones" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function FeaturesPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const rows = await callRpc<StoreFeatureRow[]>(supabase, "store_features", {
    p_store_id: ctx.store.id,
  });
  const features = visibleFeatures(rows ?? []);
  const canEdit = hasPermission(ctx, "store.update");

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Funciones</h1>
        <p className="text-sm text-fg-muted">
          Enciende o apaga funciones de tu tienda. El cambio se aplica al momento y lo puedes
          deshacer cuando quieras.
        </p>
      </header>
      {features.length === 0 ? (
        <p className="text-sm">Por ahora no hay funciones que puedas cambiar.</p>
      ) : (
        <div className="max-w-2xl space-y-3">
          {features.map((f) => (
            <FeatureToggle
              key={f.key}
              storeHandle={ctx.store.handle}
              featureKey={f.key}
              title={f.title}
              description={f.description}
              where={f.where}
              enabled={f.enabled}
              locked={f.locked}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </section>
  );
}
