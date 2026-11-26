import "server-only";

import type { LaunchInput, LaunchIssue } from "@/lib/onboarding/launch-steps";
import type { createSupabaseServerClient } from "@/server/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Lo que necesita «Lanza tu tienda» para contar los pasos (Inicio y Configurar
 * tienda). Solo lectura, con los permisos de quien mira (RLS). Si algo falla
 * devuelve null: el Inicio dice «No pudimos revisar qué le falta», nunca un
 * avance inventado.
 */
export async function loadLaunchInput(
  supabase: Supabase,
  store: { id: string; handle: string; status: string },
): Promise<LaunchInput | null> {
  const [checklist, profile, theme, samples, rates, domain] = await Promise.all([
    supabase.rpc("stores_launch_checklist", { p_store_id: store.id }),
    supabase
      .from("stores")
      .select("currency, tax_rate_bps, prices_include_tax")
      .eq("id", store.id)
      .single(),
    supabase
      .from("store_themes")
      .select("settings, draft_settings, logo_media_id, draft_logo_media_id")
      .eq("store_id", store.id)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .contains("tags", ["ejemplo"])
      .is("deleted_at", null),
    supabase
      .from("shipping_rates")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .eq("is_active", true),
    supabase
      .from("store_domains")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .eq("type", "custom")
      .eq("is_primary", true),
  ]);
  if (checklist.error || profile.error || theme.error || samples.error || rates.error) return null;
  if (domain.error) return null;
  const t = theme.data;
  // El borrador manda; sin borrador, lo publicado (igual que Configurar tienda).
  const logoId = t?.draft_settings ? t.draft_logo_media_id : t?.logo_media_id;
  let hasLogo = false;
  if (logoId) {
    const { count, error } = await supabase
      .from("media")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .eq("id", logoId)
      .eq("status", "ready")
      .is("deleted_at", null);
    if (error) return null;
    hasLogo = (count ?? 0) > 0;
  }
  const result = checklist.data as { status: string; issues: LaunchIssue[] };
  return {
    issues: result.issues ?? [],
    launched: result.status === "active",
    brandingSaved: Boolean(
      t?.draft_settings || (t?.settings as { colors?: unknown } | null)?.colors,
    ),
    hasLogo,
    sampleCount: samples.count ?? 0,
    shippingZones: rates.count ?? 0,
    taxRateBps: (profile.data.tax_rate_bps as number | null) ?? 0,
    pricesIncludeTax: Boolean(profile.data.prices_include_tax),
    currency: (profile.data.currency as string | null) ?? "MXN",
    customDomain: (domain.count ?? 0) > 0,
    base: `/admin/${store.handle}`,
  };
}
