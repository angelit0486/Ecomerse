"use server";

import { revalidatePath } from "next/cache";

import { reportActionError } from "@/server/actions/report";
import { requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { invalidateCompliance } from "@/server/storefront/cache";
import { createSupabaseServerClient } from "@/server/supabase/server";

import type { ConsoleState } from "../actions";

/**
 * Reglas regulatorias de la plataforma (R-T02, ADR-021). Solo platform_owner y
 * platform_admin con aal2 (lo exigen las RPC). El texto de las leyendas lo da el
 * asesor regulatorio: la consola nunca lo propone.
 */
const PATH = "/platform/cumplimiento";
const FIELD_TEXT: Record<string, string> = {
  kind: "Elige el tipo de regla.",
  key: "Clave de 2 a 40 caracteres: minúsculas, números y guion bajo, empezando con letra.",
  label: "Escribe un nombre de hasta 120 caracteres.",
  body: "Escribe el texto (leyenda hasta 2 000 caracteres; término de 2 a 60).",
  field_key: "Elige un campo de la ficha.",
  placements: "Elige al menos un lugar donde se muestra la leyenda.",
  position: "Orden entre 0 y 1000.",
  status: "Estado inválido.",
  reviewed_by: "Escribe quién revisó las reglas (2 a 120 caracteres).",
  review_notes: "Las notas admiten hasta 2 000 caracteres.",
};

async function attempt(
  work: () => Promise<string>,
  values?: Record<string, string>,
): Promise<ConsoleState> {
  let message: string;
  try {
    await requirePlatformRole();
    message = await work();
  } catch (error) {
    const e = reportActionError("platform", error);
    const fields = e.fields
      ? Object.fromEntries(
          Object.keys(e.fields).map((k) => [k, FIELD_TEXT[k] ?? "Revisa este dato."]),
        )
      : undefined;
    return {
      error: fields
        ? Object.values(fields)[0]
        : e.code === "forbidden"
          ? "Tu rol no permite cambiar reglas."
          : e.message,
      ...(fields ? { fields } : {}),
      ...(values ? { values } : {}),
    };
  }
  revalidatePath(PATH);
  return { ok: true, message };
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

export async function saveComplianceRule(
  profileId: string,
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  const values = Object.fromEntries(
    ["kind", "key", "label", "body", "field_key", "position"].map((k) => [k, text(formData, k)]),
  );
  const placements = formData.getAll("placements").map(String);
  values.placements = placements.join(",");
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "platform_compliance_rule_save", {
      p_profile_id: profileId,
      p_rule: {
        kind: values.kind,
        key: values.key,
        label: values.label,
        body: values.body,
        field_key: values.field_key,
        placements,
        position: values.position === "" ? 0 : Number(values.position),
      },
    });
    // Las leyendas de todas las tiendas del país cambian (R-T03).
    invalidateCompliance();
    return "Regla guardada.";
  }, values);
}

export async function retireComplianceRule(
  ruleId: string,
  _: ConsoleState,
  __: FormData,
): Promise<ConsoleState> {
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "platform_compliance_rule_retire", { p_rule_id: ruleId });
    // Las leyendas de todas las tiendas del país cambian (R-T03).
    invalidateCompliance();
    return "Regla retirada.";
  });
}

export async function setComplianceProfileStatus(
  profileId: string,
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  const values = Object.fromEntries(
    ["status", "reviewed_by", "review_notes"].map((k) => [k, text(formData, k)]),
  );
  if (values.status !== "active" && formData.get("confirm") !== "1") {
    return {
      error: "Confirma que entiendes que los productos de esta categoría se despublicarán.",
      fields: { confirm: "required" },
      values,
    };
  }
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "platform_compliance_profile_set_status", {
      p_profile_id: profileId,
      p_status: values.status,
      p_reviewed_by: values.reviewed_by,
      p_notes: values.review_notes,
    });
    // Las leyendas de todas las tiendas del país cambian (R-T03).
    invalidateCompliance();
    return values.status === "active" ? "Reglas marcadas como revisadas." : "Estado actualizado.";
  }, values);
}
