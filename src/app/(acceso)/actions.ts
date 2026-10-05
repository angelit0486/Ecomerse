"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { recordSecurityEvent } from "@/server/auth/security-events";
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
const emailSchema = z.email().max(254);
const codeSchema = z.string().regex(/^\d{6}$/);

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
    secure: serverEnv().APP_ENV === "production" || serverEnv().APP_ENV === "preview",
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
  redirect("/admin");
}
