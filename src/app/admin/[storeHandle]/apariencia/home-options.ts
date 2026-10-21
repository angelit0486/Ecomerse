import "server-only";

import { publicMediaUrl } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import type { HomeEditorOptions } from "./home-editor";

/**
 * Opciones del editor de bloques (portada y páginas, ADR-034): imágenes,
 * categorías, marcas, objetivos y productos de la tienda.
 */
export async function loadHomeOptions(
  storeId: string,
  media: {
    id: string;
    owner_type: string;
    status: string;
    storage_path: string;
    alt_text: string | null;
  }[],
): Promise<HomeEditorOptions> {
  const supabase = await createSupabaseServerClient();
  const [{ data: categories }, { data: brands }, { data: attributes }, { data: products }] =
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
  };
}
