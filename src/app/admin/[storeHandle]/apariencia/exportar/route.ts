import { NextResponse, type NextRequest } from "next/server";

import { portableDesign, themeFile } from "@/lib/theme/portable";
import { HomeSectionsV2, ThemeSettingsV2 } from "@/lib/theme/schema";
import { reportActionError } from "@/server/actions/report";
import { hasPermission } from "@/server/auth/context";

import { storeClient } from "../../_shared/action-state";

/**
 * Descarga del diseño (ADR-034 §6): el borrador si hay, si no lo publicado, sin
 * imágenes ni filas de la tienda. Solo lectura y sin caché; pide el permiso de
 * apariencia, como el editor.
 */
type Params = { params: Promise<{ storeHandle: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const { storeHandle } = await params;
  try {
    const { supabase, storeId, ctx } = await storeClient(storeHandle);
    if (!hasPermission(ctx, "appearance.manage")) return new NextResponse(null, { status: 403 });
    const { data: theme, error } = await supabase
      .from("store_themes")
      .select("settings, home_sections, draft_settings, draft_home_sections")
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw error;
    const settings = ThemeSettingsV2.safeParse(theme?.draft_settings ?? theme?.settings ?? {});
    const sections = HomeSectionsV2.safeParse(
      theme?.draft_settings ? theme.draft_home_sections : (theme?.home_sections ?? []),
    );
    const design = portableDesign(
      settings.success ? settings.data : {},
      sections.success ? sections.data : [],
    );
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(themeFile(design, ctx.store.name), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${ctx.store.handle}-diseno-${date}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    reportActionError("appearance", error);
    return new NextResponse(null, { status: 404 });
  }
}
