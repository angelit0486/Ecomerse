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
      "id, type, slug, title, body_html, is_published, seo_title, seo_description, updated_at",
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

/** Productos para elegir como destino de menú (los más recientes; el menú es corto). */
export async function listProductTargets(
  supabase: SupabaseClient,
  storeId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, title")
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as { id: string; title: string }[]).map((p) => ({
    id: p.id,
    name: p.title,
  }));
}
