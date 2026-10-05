import "server-only";

import { redirect } from "next/navigation";

import { getSession, type Session } from "./session";

/**
 * Puertas del panel y de la consola (GATE0 §7.5): sin sesión → /ingresar; con
 * sesión aal1 → /seguridad/2fa. Es solo UX: la base exige AAL2 de todas formas.
 */
export async function requireStaffSession(): Promise<Session & { aal: "aal2" }> {
  const session = await getSession();
  if (!session) redirect("/ingresar");
  if (session.aal !== "aal2") redirect("/seguridad/2fa");
  return session as Session & { aal: "aal2" };
}
