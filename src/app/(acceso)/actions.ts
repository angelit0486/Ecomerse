"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { recordSecurityEvent } from "@/server/auth/security-events";
import { toAppError } from "@/server/db/errors";
import { callRpc } from "@/server/db/rpc";
import { peekInvitation } from "@/server/invitations/peek";
import { getSession } from "@/server/auth/session";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * Acceso del staff (GATE0 §7.2, Q-B2): código por email → TOTP obligatorio →
 * AAL2. Sin autorregistro: el staff entra solo por invitación.
 */

export interface FormState {
  error?: string;
}

const LOGIN_EMAIL_COOKIE = "staff_login_email";
/** Token de la invitación en curso (HttpOnly): tras el login y la 2FA se vuelve a ella. */
const INVITATION_COOKIE = "staff_invitation";
const emailSchema = z.email().max(254);
const codeSchema = z.string().regex(/^\d{6}$/);

function secureCookies(): boolean {
  const env = serverEnv().APP_ENV;
  return env === "production" || env === "preview";
}

export async function requestLoginCode(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!parsed.success) return { error: "Escribe un email válido." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false },
  });
  if (error?.status === 429) return { error: "Demasiados intentos. Espera un momento." };
  // Cualquier otro error (p. ej. email sin cuenta) se trata igual que un éxito: la
  // respuesta no revela qué emails tienen cuenta.
  await recordSecurityEvent("auth.login_code_requested");

  (await cookies()).set(LOGIN_EMAIL_COOKIE, parsed.data, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  redirect("/ingresar/codigo");
}

export async function verifyLoginCode(_: FormState, formData: FormData): Promise<FormState> {
  const cookieStore = await cookies();
  const email = cookieStore.get(LOGIN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/ingresar");
  const code = codeSchema.safeParse(String(formData.get("code") ?? "").replace(/\s/g, ""));
  if (!code.success) return { error: "El código tiene 6 dígitos." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code.data,
    type: "email",
  });
  if (error || !data.user) {
    await recordSecurityEvent("auth.login_failed", { metadata: { reason: "invalid_code" } });
    return { error: "El código no es correcto o caducó. Pide uno nuevo si hace falta." };
  }
  await recordSecurityEvent("auth.login_succeeded", { userId: data.user.id });
  cookieStore.delete(LOGIN_EMAIL_COOKIE);
  redirect("/seguridad/2fa");
}

export interface EnrollState extends FormState {
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

/** Inicia el enrolamiento TOTP: descarta factores sin verificar y crea uno nuevo. */
export async function startTotpEnrollment(_: EnrollState): Promise<EnrollState> {
  const session = await getSession();
  if (!session) redirect("/ingresar");
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Autenticador ${new Date().toISOString().slice(0, 16)}`,
  });
  if (error || !data) return { error: "No pudimos iniciar la activación. Inténtalo de nuevo." };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Verifica un código TOTP (enrolamiento o inicio de sesión) y eleva la sesión a AAL2. */
export async function verifyTotp(_: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect("/ingresar");
  const factorId = String(formData.get("factorId") ?? "");
  const enrolling = formData.get("enrolling") === "1";
  const code = codeSchema.safeParse(String(formData.get("code") ?? "").replace(/\s/g, ""));
  if (!code.success || !/^[0-9a-f-]{36}$/.test(factorId)) {
    return { error: "El código tiene 6 dígitos." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.data });
  if (error) {
    await recordSecurityEvent("auth.mfa_failed", { userId: session.userId });
    return {
      error: "El código no es correcto. Revisa la hora de tu teléfono e inténtalo de nuevo.",
    };
  }
  await recordSecurityEvent(enrolling ? "auth.mfa_enrolled" : "auth.mfa_verified", {
    userId: session.userId,
  });
  const invitation = (await cookies()).get(INVITATION_COOKIE)?.value;
  redirect(
    invitation && /^[0-9a-f]{64}$/.test(invitation) ? `/invitacion/${invitation}` : "/admin",
  );
}

// -----------------------------------------------------------------------------
// Invitaciones (GATE0 §7.2): el alta de una cuenta solo ocurre aquí, y solo para
// el email de una invitación vigente.
// -----------------------------------------------------------------------------

/** Envía el código al email invitado (crea la cuenta si no existe) y guarda la invitación. */
export async function startInvitationLogin(token: string): Promise<FormState> {
  const invitation = await peekInvitation(token);
  if (!invitation) return { error: "La invitación no es válida o caducó. Pide una nueva." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: invitation.email,
    options: { shouldCreateUser: true },
  });
  if (error?.status === 429) return { error: "Demasiados intentos. Espera un momento." };
  if (error) return { error: "No pudimos enviar el código. Inténtalo de nuevo." };
  await recordSecurityEvent("auth.login_code_requested", { metadata: { via: "invitation" } });

  const cookieStore = await cookies();
  const options = { httpOnly: true, secure: secureCookies(), sameSite: "lax" as const, path: "/" };
  cookieStore.set(LOGIN_EMAIL_COOKIE, invitation.email, { ...options, maxAge: 10 * 60 });
  cookieStore.set(INVITATION_COOKIE, token, { ...options, maxAge: 60 * 60 });
  redirect("/ingresar/codigo");
}

/** Sesión aal1 ya iniciada: recuerda la invitación y completa la 2FA. */
export async function continueInvitation(token: string): Promise<void> {
  (await cookies()).set(INVITATION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  redirect("/seguridad/2fa");
}

export async function acceptInvitation(token: string): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect(`/invitacion/${token}`);
  const supabase = await createSupabaseServerClient();
  let target = "/admin";
  try {
    const result = await callRpc<{ store_id: string | null }>(
      supabase,
      "access_accept_invitation",
      {
        p_token: token,
      },
    );
    if (result.store_id) {
      const stores = await callRpc<{ store_id: string; handle: string }[]>(
        supabase,
        "access_list_my_stores",
      );
      const handle = stores.find((s) => s.store_id === result.store_id)?.handle;
      if (handle) target = `/admin/${handle}`;
    }
  } catch (error) {
    return { error: toAppError(error).message };
  }
  (await cookies()).delete(INVITATION_COOKIE);
  redirect(target);
}
