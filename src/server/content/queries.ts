import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Lecturas del panel para páginas y menús (RLS: store.read). */
export interface PageRow {
  id: string;
  type: string;
  slug: string;
  title: string;
  body_html: string;
  is_published: boolean;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
  seo_image_media_id?: string | null;
  sections?: unknown[];
  draft_sections?: unknown[] | null;
}

export async function listPages(supabase: SupabaseClient, storeId: string): Promise<PageRow[]> {
  const { data, error } = await supabase
    .from("store_pages")
    .select(
      "id, type, slug, title, body_html, is_published, seo_title, seo_description, updated_at",
    )
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("type")
    .order("title");
  if (error) throw error;
  return (data ?? []) as PageRow[];
}

export async function getPage(
  supabase: SupabaseClient,
  storeId: string,
  pageId: string,
): Promise<PageRow | null> {
  const { data, error } = await supabase
    .from("store_pages")
    .select(
      "id, type, slug, title, body_html, is_published, seo_title, seo_description, updated_at, seo_image_media_id, sections, draft_sections",
    )
    .eq("store_id", storeId)
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as PageRow | null) ?? null;
}

export interface MenuItemRow {
  id: string;
  parent_id: string | null;
  label: string;
  link_type: string;
  target_id: string | null;
  url: string | null;
  position: number;
}

export async function getMenuItems(
  supabase: SupabaseClient,
  storeId: string,
  handle: "main" | "footer",
): Promise<MenuItemRow[]> {
  const { data, error } = await supabase
    .from("menus")
    .select("id, menu_items(id, parent_id, label, link_type, target_id, url, position)")
    .eq("store_id", storeId)
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw error;
  const items = ((data as { menu_items?: MenuItemRow[] } | null)?.menu_items ?? []).slice();
  return items.sort((a, b) => a.position - b.position);
}

/**
 * Productos para elegir como destino de menú: los 200 más recientes más los que
 * los menús ya enlazan (para no perder un destino antiguo al editar).
 */
export async function listProductTargets(
  supabase: SupabaseClient,
  storeId: string,
  linkedIds: string[],
): Promise<{ id: string; name: string }[]> {
  const query = () =>
    supabase.from("products").select("id, title").eq("store_id", storeId).is("deleted_at", null);
  const [recent, linked] = await Promise.all([
    query().order("updated_at", { ascending: false }).limit(200),
    linkedIds.length ? query().in("id", linkedIds.slice(0, 100)) : null,
  ]);
  if (recent.error) throw recent.error;
  if (linked?.error) throw linked.error;
  const rows = [...(linked?.data ?? []), ...(recent.data ?? [])] as { id: string; title: string }[];
  const byId = new Map(rows.map((p) => [p.id, { id: p.id, name: p.title }]));
  return [...byId.values()];
}
