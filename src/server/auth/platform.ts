import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { requireStaffSession } from "./guards";

export type PlatformRole = "platform_owner" | "platform_admin" | "platform_support";

/**
 * Rol de plataforma del request (GATE0 §7.6). Sin rol → 404 (la consola no
 * revela que existe). Solo UX: cada RPC de plataforma vuelve a exigir el rol.
 */
export const requirePlatformRole = cache(async (): Promise<PlatformRole> => {
  await requireStaffSession();
  const supabase = await createSupabaseServerClient();
  const role = await callRpc<PlatformRole | null>(supabase, "access_platform_role");
  if (!role) notFound();
  return role;
});

export function canManageTenants(role: PlatformRole): boolean {
  return role === "platform_owner" || role === "platform_admin";
}
