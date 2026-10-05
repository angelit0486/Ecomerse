import "server-only";

import { workerDb } from "@/server/db/role-clients";

export interface InvitationPeek {
  email: string;
  organizationName: string;
  storeName: string | null;
  expiresAt: Date;
}

/** Invitación vigente para el token (system.peek_invitation, rol system_worker). */
export async function peekInvitation(token: string): Promise<InvitationPeek | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const rows = await workerDb()<
    { email: string; organization_name: string; store_name: string | null; expires_at: Date }[]
  >`select * from system.peek_invitation(${token})`;
  const row = rows[0];
  return row
    ? {
        email: row.email,
        organizationName: row.organization_name,
        storeName: row.store_name,
        expiresAt: row.expires_at,
      }
    : null;
}

/** "ana@tienda.mx" → "a**@tienda.mx" (para mostrar a quién va el código). */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
}
