"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformRole } from "@/server/auth/platform";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Acciones de la consola de plataforma. La autorización real está en las RPC. */
export interface ConsoleState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
}

const FIELD_TEXT: Record<string, string> = {
  plan: "Elige un plan activo.",
  trial_days: "Días de prueba entre 0 y 90.",
  reason: "Escribe un motivo (mínimo 20 caracteres).",
  minutes: "Elige una duración de hasta 60 minutos.",
  grantee: "Elige a alguien del equipo de soporte.",
  status: "Estado inválido.",
};

async function attempt(work: () => Promise<string>, revalidate: string): Promise<ConsoleState> {
  let message: string;
  try {
    await requirePlatformRole();
    message = await work();
  } catch (error) {
    const appError = reportActionError("platform", error);
    const fields = appError.fields
      ? Object.fromEntries(
          Object.keys(appError.fields).map((k) => [k, FIELD_TEXT[k] ?? "Revisa este dato."]),
        )
      : undefined;
    return { error: appError.message, ...(fields ? { fields } : {}) };
  }
  revalidatePath(revalidate);
  return { ok: true, message };
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

export async function createTenant(_: ConsoleState, formData: FormData): Promise<ConsoleState> {
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    const result = await callRpc<{ hostname: string }>(
      supabase,
      "platform_create_organization_with_store",
      {
        p_org_name: text(formData, "org_name"),
        p_org_slug: text(formData, "org_slug"),
        p_org_country: text(formData, "country") || "MX",
        p_owner_email: text(formData, "owner_email"),
        p_store_name: text(formData, "store_name"),
        p_store_handle: text(formData, "store_handle"),
        p_plan_key: text(formData, "plan"),
      },
    );
    return `Tienda creada en ${result.hostname}. Enviamos la invitación al dueño.`;
  }, "/platform");
}

export async function setOrganizationStatus(
  organizationId: string,
  status: "active" | "suspended",
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "platform_set_tenant_status", {
      p_organization_id: organizationId,
      p_status: status,
      p_reason: text(formData, "reason"),
    });
    return status === "suspended" ? "Organización suspendida." : "Organización reactivada.";
  }, "/platform");
}

export async function grantSupport(_: ConsoleState, formData: FormData): Promise<ConsoleState> {
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "platform_grant_support_access", {
      p_store_id: text(formData, "store_id"),
      p_grantee_user_id: text(formData, "grantee"),
      p_reason: text(formData, "reason"),
      p_minutes: Number(text(formData, "minutes") || 30),
      p_ticket_ref: text(formData, "ticket_ref") || null,
    });
    return "Acceso concedido. Avisamos al dueño de la tienda.";
  }, "/platform/soporte");
}

export async function revokeSupport(grantId: string): Promise<ConsoleState> {
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "platform_revoke_support_access", { p_grant_id: grantId });
    return "Acceso revocado.";
  }, "/platform/soporte");
}
