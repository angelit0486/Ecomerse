import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { NewStoreForm } from "./new-store-form";

export const metadata: Metadata = { title: "Nueva tienda" };

/**
 * ADR-038: otra tienda en la organización de la dueña. «tiendas» es un nombre de
 * dirección reservado, así que esta ruta nunca choca con `/admin/[storeHandle]`.
 */
export default async function NewStorePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const orgs = await callRpc<{ organization_id: string; organization_name: string }[]>(
    supabase,
    "access_orgs_can_create_stores",
  );
  const chosen =
    org && z.uuid().safeParse(org).success
      ? orgs.find((o) => o.organization_id === org)
      : orgs.length === 1
        ? orgs[0]
        : undefined;
  if (!chosen) notFound();

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin" className="inline-flex min-h-11 items-center text-sm underline">
          ← Tus tiendas
        </Link>
        <h1 className="text-xl font-semibold">Nueva tienda en {chosen.organization_name}</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          Nace en borrador: nadie la ve hasta que la publiques. Después eliges una plantilla o
          copias la estructura de otra de tus tiendas, subes el logo y configuras pagos. Tu plan
          limita cuántas tiendas puedes tener.
        </p>
      </header>
      <NewStoreForm organizationId={chosen.organization_id} />
    </section>
  );
}
