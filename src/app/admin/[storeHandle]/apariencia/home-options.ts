import "server-only";

import type { LinkTargets } from "@/lib/theme/link-targets";
import { hasPermission, type StoreContext } from "@/server/auth/context";
import { publicMediaUrl } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import type { HomeEditorOptions } from "./home-editor";

/**
 * Opciones del editor de bloques (portada y páginas, ADR-034): imágenes,
 * categorías, marcas, objetivos y productos de la tienda.
 */
export async function loadHomeOptions(
  storeId: string,
  access: { products: boolean; seo: boolean },
  media: {
    id: string;
    owner_type: string;
    status: string;
    storage_path: string;
    alt_text: string | null;
  }[],
): Promise<HomeEditorOptions> {
  const supabase = await createSupabaseServerClient();
  const [{ data: categories }, { data: brands }, { data: attributes }, { data: products }, links] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, depth")
        .eq("store_id", storeId)
        .eq("is_visible", true)
        .is("deleted_at", null)
        .order("path"),
      supabase
        .from("brands")
        .select("id, name, logo_media_id")
        .eq("store_id", storeId)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("attributes")
        .select("name, is_filterable, attribute_values(id, label, position)")
        .eq("store_id", storeId)
        .eq("is_filterable", true)
        .order("position"),
      // Para «Productos elegidos a mano»: los publicados y los borradores (se
      // muestran solo cuando se publican), los más recientes primero.
      supabase
        .from("products")
        .select("id, title, status")
        .eq("store_id", storeId)
        .is("deleted_at", null)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(500),
      loadLinkTargets(storeId, access),
    ]);
  return {
    banners: media
      .filter((m) => m.owner_type === "banner" && m.status === "ready")
      .map((m) => ({ id: m.id, url: publicMediaUrl(m.storage_path), alt: m.alt_text })),
    categories: (categories ?? []).map((c) => ({
      id: c.id,
      name: `${"— ".repeat(c.depth ?? 0)}${c.name}`,
    })),
    brands: (brands ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      hasLogo: Boolean(b.logo_media_id),
    })),
    goals: (attributes ?? []).flatMap((a) =>
      [...((a.attribute_values ?? []) as { id: string; label: string; position: number }[])]
        .sort((x, y) => x.position - y.position)
        .map((v) => ({ id: v.id, label: `${a.name}: ${v.label}` })),
    ),
    products: (products ?? []).map((p) => ({
      id: p.id,
      title: p.status === "active" ? p.title : `${p.title} (borrador)`,
    })),
    links,
  };
}

/** Qué listas puede leer este rol (las demás quedan en `null`). */
export function linkAccess(ctx: StoreContext): { products: boolean; seo: boolean } {
  return { products: hasPermission(ctx, "products.read"), seo: hasPermission(ctx, "seo.manage") };
}

/**
 * Páginas reales de la tienda para revisar los enlaces de los botones
 * (DIAGNOSTICO-PORTADA R3). Lo que el rol no puede leer (RLS) o una consulta
 * que falla queda en `null` y no produce avisos (revisión del Paso 1). Los
 * productos no se cargan completos: los slugs que se piden se buscan aparte.
 */
export async function loadLinkTargets(
  storeId: string,
  access: { products: boolean; seo: boolean },
  productSlugs: string[] = [],
): Promise<LinkTargets> {
  const supabase = await createSupabaseServerClient();
  const list = <T extends Record<string, unknown>>(
    r: { data: T[] | null; error: unknown },
    key: keyof T,
  ): string[] | null => (r.error || !r.data ? null : r.data.map((row) => String(row[key])));
  const slugs = [...new Set(productSlugs)].slice(0, 100);
  const [categories, brands, pages, products, redirects] = await Promise.all([
    access.products
      ? supabase
          .from("categories")
          .select("path")
          .eq("store_id", storeId)
          .eq("is_visible", true)
          .is("deleted_at", null)
      : null,
    access.products
      ? supabase.from("brands").select("slug").eq("store_id", storeId).is("deleted_at", null)
      : null,
    supabase
      .from("store_pages")
      .select("slug")
      .eq("store_id", storeId)
      .eq("is_published", true)
      .is("deleted_at", null),
    access.products && slugs.length > 0
      ? supabase
          .from("products")
          .select("slug")
          .eq("store_id", storeId)
          .eq("status", "active")
          .is("deleted_at", null)
          .in("slug", slugs)
      : null,
    access.seo
      ? supabase.from("store_redirects").select("from_path").eq("store_id", storeId).limit(1000)
      : null,
  ]);
  return {
    categories: categories ? list(categories, "path") : null,
    brands: brands ? list(brands, "slug") : null,
    pages: list(pages, "slug"),
    // Sin slugs que revisar (el editor en vivo) no se sabe: no avisa de productos.
    products: products ? list(products, "slug") : null,
    redirects: redirects ? list(redirects, "from_path") : null,
  };
}
