import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordSecurityEvent } from "@/server/auth/security-events";
import { callRpc } from "@/server/db/rpc";
import { deleteAllMfaFactors } from "@/server/privileged/auth-admin";

/**
 * Reset de la verificación en dos pasos de un miembro (GATE0 §7.2, SR-1):
 * 1) la base autoriza y audita con la sesión del actor (RPC);
 * 2) solo entonces, Auth Admin elimina sus factores.
 * El miembro vuelve a enrolar TOTP en su siguiente acceso.
 */
export async function resetMemberMfa(
  actorClient: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  await callRpc(actorClient, "access_authorize_mfa_reset", {
    p_organization_id: organizationId,
    p_user_id: userId,
  });
  const removed = await deleteAllMfaFactors(userId);
  await recordSecurityEvent("auth.mfa_reset", { userId, metadata: { factors: removed } });
}
