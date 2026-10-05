"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStoreContext } from "@/server/auth/store-context";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { resetMemberMfa } from "@/server/team/mfa-reset";

/**
 * Acciones de Ajustes → Equipo. Cada una vuelve a resolver el contexto de la
 * tienda (la tienda viene de la URL, nunca del cliente) y delega la
 * autorización en las RPC (GATE0 §8.3). Un error se devuelve como mensaje.
 */
export interface TeamActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

const uuid = z.uuid();

async function run(
  storeHandle: string,
  work: (input: {
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    storeId: string;
    organizationId: string;
  }) => Promise<void>,
  successMessage: string,
): Promise<TeamActionState> {
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await work({ supabase, storeId: ctx.store.id, organizationId: ctx.store.organization_id });
  } catch (error) {
    const appError = reportActionError("team", error);
    return {
      error: appError.message,
      ...(appError.fields ? { fields: { ...appError.fields } } : {}),
    };
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/equipo`);
  return { ok: true, message: successMessage };
}

export async function inviteMember(
  storeHandle: string,
  _: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const roleKey = String(formData.get("role") ?? "");
  if (!z.email().safeParse(email).success) {
    return {
      error: "Revisa los datos marcados.",
      fields: { email: "Escribe un email válido." },
      values: { email },
    };
  }
  if (!/^[a-z_]{2,40}$/.test(roleKey)) {
    return { error: "Revisa los datos marcados.", fields: { role: "Elige un rol." } };
  }
  const result = await run(
    storeHandle,
    async ({ supabase, storeId, organizationId }) => {
      await callRpc(supabase, "access_invite_member", {
        p_organization_id: organizationId,
        p_email: email,
        p_store_id: storeId,
        p_store_role_key: roleKey,
      });
    },
    `Invitación enviada a ${email}.`,
  );
  return result.ok ? result : { ...result, values: { email } };
}

export async function changeMemberRole(
  storeHandle: string,
  userId: string,
  roleKey: string,
): Promise<TeamActionState> {
  if (!uuid.safeParse(userId).success) return { error: "Miembro inválido." };
  return run(
    storeHandle,
    async ({ supabase, storeId }) => {
      await callRpc(supabase, "access_change_member_role", {
        p_store_id: storeId,
        p_user_id: userId,
        p_role_key: roleKey,
      });
    },
    "Rol actualizado.",
  );
}

export async function setMemberStatus(
  storeHandle: string,
  userId: string,
  status: "suspended" | "active",
): Promise<TeamActionState> {
  if (!uuid.safeParse(userId).success) return { error: "Miembro inválido." };
  return run(
    storeHandle,
    async ({ supabase, storeId, organizationId }) => {
      await callRpc(
        supabase,
        status === "suspended" ? "access_suspend_member" : "access_reactivate_member",
        { p_organization_id: organizationId, p_user_id: userId, p_store_id: storeId },
      );
    },
    status === "suspended" ? "Acceso suspendido." : "Acceso reactivado.",
  );
}

export async function removeMember(storeHandle: string, userId: string): Promise<TeamActionState> {
  if (!uuid.safeParse(userId).success) return { error: "Miembro inválido." };
  return run(
    storeHandle,
    async ({ supabase, storeId, organizationId }) => {
      await callRpc(supabase, "access_remove_member", {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_store_id: storeId,
      });
    },
    "Miembro quitado de la tienda.",
  );
}

export async function revokeInvitation(
  storeHandle: string,
  invitationId: string,
): Promise<TeamActionState> {
  if (!uuid.safeParse(invitationId).success) return { error: "Invitación inválida." };
  return run(
    storeHandle,
    async ({ supabase }) => {
      await callRpc(supabase, "access_revoke_invitation", { p_invitation_id: invitationId });
    },
    "Invitación revocada.",
  );
}

export async function resetMfa(storeHandle: string, userId: string): Promise<TeamActionState> {
  if (!uuid.safeParse(userId).success) return { error: "Miembro inválido." };
  return run(
    storeHandle,
    async ({ supabase, organizationId }) => {
      await resetMemberMfa(supabase, organizationId, userId);
    },
    "Verificación en dos pasos restablecida: la configurará de nuevo al entrar.",
  );
}
