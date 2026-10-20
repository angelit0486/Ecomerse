import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listBrands, listCategories } from "@/server/catalog/queries";
import {
  getMenuItems,
  listPages,
  listProductTargets,
  type MenuItemRow,
} from "@/server/content/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { filterHref } from "../labels";
import { MenuEditor, type MenuDraft, type TargetOptions } from "./menu-editor";

export const metadata: Metadata = { title: "Menús" };

type Props = { params: Promise<{ storeHandle: string }> };

/** Un destino que ya no está entre las opciones (borrado) se vacía y se marca. */
function toDrafts(rows: MenuItemRow[], targets: TargetOptions): MenuDraft[] {
  const draft = (r: MenuItemRow): MenuDraft => {
    // Un enlace `/productos?atributo=valor` conocido se edita como «Objetivo o filtro».
    const filter =
      r.link_type === "url" ? targets.filter.find((o) => filterHref(o.id) === r.url) : undefined;
    if (filter) {
      return {
        key: r.id,
        label: r.label,
        link_type: "filter",
        target_id: filter.id,
        url: "",
        children: [],
      };
    }
    const options = targets[r.link_type as keyof TargetOptions];
    const stale = Boolean(options && r.target_id && !options.some((o) => o.id === r.target_id));
    return {
      key: r.id,
      label: r.label,
      link_type: r.link_type,
      target_id: stale ? "" : (r.target_id ?? ""),
      url: r.url ?? "",
      children: [],
      ...(stale ? { stale: true } : {}),
    };
  };
  const roots = rows.filter((r) => !r.parent_id).map(draft);
  for (const r of rows) {
    if (r.parent_id) roots.find((p) => p.key === r.parent_id)?.children.push(draft(r));
  }
  return roots;
}

export default async function MenusPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "appearance.manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const [main, footer] = await Promise.all([
    getMenuItems(supabase, ctx.store.id, "main"),
    getMenuItems(supabase, ctx.store.id, "footer"),
  ]);
  const linkedProducts = [...main, ...footer].flatMap((i) =>
    i.link_type === "product" && i.target_id ? [i.target_id] : [],
  );
  const [categories, brands, pages, products, { data: attributes }] = await Promise.all([
    listCategories(supabase, ctx.store.id),
    listBrands(supabase, ctx.store.id),
    listPages(supabase, ctx.store.id),
    listProductTargets(supabase, ctx.store.id, linkedProducts),
    supabase
      .from("attributes")
      .select("key, name, position, attribute_values(key, label, position)")
      .eq("store_id", ctx.store.id)
      .eq("is_filterable", true)
      .order("position"),
  ]);
  const targets: TargetOptions = {
    category: categories.map((c) => ({ id: c.id, name: `${"— ".repeat(c.depth)}${c.name}` })),
    brand: brands.map((b) => ({ id: b.id, name: b.name })),
    page: pages.map((p) => ({
      id: p.id,
      name: p.is_published ? p.title : `${p.title} (borrador)`,
    })),
    product: products,
    // Valores de atributos filtrables (objetivo, sabor…): id = "atributo=valor".
    filter: (attributes ?? []).flatMap((a) =>
      [...(a.attribute_values ?? [])]
        .sort((x, y) => x.position - y.position)
        .map((v) => ({ id: `${a.key}=${v.key}`, name: `${a.name}: ${v.label}` })),
    ),
  };

  return (
    <section className="space-y-6">
      <header>
        <Link
          href={`/admin/${ctx.store.handle}/contenido`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          ← Contenido
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Menús</h1>
        <p className="text-sm text-fg-muted">
          Hasta 50 enlaces por menú y dos niveles. Los enlaces a algo oculto o en borrador no se
          muestran en la tienda.
        </p>
      </header>
      <MenuEditor
        storeHandle={ctx.store.handle}
        handle="main"
        title="Menú principal"
        initial={toDrafts(main, targets)}
        targets={targets}
      />
      <MenuEditor
        storeHandle={ctx.store.handle}
        handle="footer"
        title="Menú del pie"
        initial={toDrafts(footer, targets)}
        targets={targets}
      />
    </section>
  );
}
