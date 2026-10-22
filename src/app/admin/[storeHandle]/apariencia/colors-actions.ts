"use server";

import { revalidatePath } from "next/cache";

import { contrastRatio } from "@/lib/color/contrast";
import { HomeSectionsV2 } from "@/lib/theme/schema";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { themeRpcError } from "@/server/theme/errors";

import { storeClient, type FormState } from "../_shared/action-state";
import { saveThemeSection } from "./actions";

/**
 * Portada → Colores (misión Panel, Paso C). Guarda en el borrador la paleta,
 * el color de oferta y los colores por elemento (como cualquier pestaña del
 * tema) y, aparte, los colores de cada bloque de la portada. De los bloques
 * solo cambia `colors`: el orden, el contenido y el diseño quedan igual.
 */
const HEX = /^#[0-9a-f]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type BlockColors = Record<string, { background: string; foreground: string } | null>;

function readBlockColors(raw: string): BlockColors | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return "Recarga la página e inténtalo de nuevo.";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Recarga la página e inténtalo de nuevo.";
  }
  const out: BlockColors = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!UUID.test(id)) return "Recarga la página e inténtalo de nuevo.";
    if (value === null) {
      out[id] = null;
      continue;
    }
    const v = value as { background?: unknown; foreground?: unknown };
    const bg = String(v.background ?? "").toLowerCase();
    const fg = String(v.foreground ?? "").toLowerCase();
    if (!HEX.test(bg) || !HEX.test(fg)) return "Elige colores válidos para cada bloque.";
    if (contrastRatio(fg, bg) < 4.5) {
      return "Hay un bloque cuyo texto no se lee sobre su fondo. Usa el color sugerido.";
    }
    out[id] = { background: bg, foreground: fg };
  }
  return out;
}

export async function saveColors(
  storeHandle: string,
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const blocks = readBlockColors(String(formData.get("block_colors") ?? "{}"));
  if (typeof blocks === "string") return { error: blocks };

  // 1. Paleta y elementos: la misma validación y contraste que las demás pestañas.
  const theme = await saveThemeSection(storeHandle, "colores", previous, formData);
  if (!theme.ok) return theme;
  if (Object.keys(blocks).length === 0) {
    return { ok: true, message: "Colores guardados en el borrador. Revísalos y publícalos." };
  }

  // 2. Colores por bloque, sobre el borrador recién guardado.
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const { data, error } = await supabase
      .from("store_themes")
      .select("draft_home_sections, home_sections, draft_revision")
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw error;
    const current = (data?.draft_home_sections ?? data?.home_sections ?? []) as {
      id: string;
      colors?: unknown;
    }[];
    const next = current.map((section) => {
      if (!(section.id in blocks)) return section;
      const colors = blocks[section.id];
      const { colors: _old, ...rest } = section;
      return colors ? { ...rest, colors } : rest;
    });
    const parsed = HomeSectionsV2.safeParse(next);
    if (!parsed.success) {
      return { error: "Algún bloque de la portada no es válido. Revísalo en Diseño." };
    }
    await callRpc(supabase, "appearance_save_home_draft", {
      p_store_id: storeId,
      p_sections: next,
      p_expected_revision: data?.draft_revision ?? 0,
    });
  } catch (error) {
    const e = themeRpcError(error);
    if (e.code === "conflict") {
      return { error: "Otra persona cambió la portada. Recarga la página y vuelve a intentarlo." };
    }
    if (e.code === "forbidden") return { error: "Tu rol no permite cambiar la apariencia." };
    reportActionError("appearance.colors", error);
    return {
      error: "Los colores del tema se guardaron, pero no los de los bloques. Inténtalo de nuevo.",
    };
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return { ok: true, message: "Colores guardados en el borrador. Revísalos y publícalos." };
}
