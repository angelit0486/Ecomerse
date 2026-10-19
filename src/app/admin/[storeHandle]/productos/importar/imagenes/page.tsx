import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listImageTargets } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { BulkImages } from "./bulk-images";

export const metadata: Metadata = { title: "Subir imágenes en lote" };

type Props = { params: Promise<{ storeHandle: string }> };

/** Productos → Importar → Imágenes: muchas fotos a la vez, asignadas por su nombre. */
export default async function BulkImagesPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.update")) notFound();
  const supabase = await createSupabaseServerClient();
  const targets = await listImageTargets(supabase, ctx.store.id);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={`/admin/${ctx.store.handle}/productos`} className="underline">
            Productos
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/${ctx.store.handle}/productos/importar`} className="underline">
            Importar
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Subir imágenes en lote</h1>
        <p className="text-sm text-fg-muted">
          Elige todas las fotos a la vez. Cada una va al producto cuyo SKU o nombre corto coincide
          con el nombre del archivo. Verás la asignación antes de subir nada.
        </p>
      </header>

      <section
        aria-labelledby="como-nombrar"
        className="space-y-2 rounded-md border border-border p-4 text-sm"
      >
        <h2 id="como-nombrar" className="font-semibold">
          Cómo nombrar las fotos
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Por SKU: <code>PRV-001.jpg</code> es la foto principal del producto con ese SKU.
          </li>
          <li>
            Más fotos del mismo producto: <code>PRV-001-2.jpg</code>, <code>PRV-001-3.jpg</code>…
          </li>
          <li>
            O por nombre corto (el handle del CSV): <code>proteina-aislada.jpg</code>.
          </li>
          <li>Las fotos se agregan a las que ya tiene el producto; no se borra ninguna.</li>
        </ul>
      </section>

      {targets.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Aún no hay productos. Primero{" "}
          <Link href={`/admin/${ctx.store.handle}/productos/importar`} className="underline">
            importa tu catálogo
          </Link>
          .
        </p>
      ) : (
        <BulkImages
          storeHandle={ctx.store.handle}
          targets={targets.map(({ id, title, slug, skus, image_count }) => ({
            id,
            title,
            slug,
            skus,
            imageCount: image_count,
          }))}
        />
      )}
    </section>
  );
}
