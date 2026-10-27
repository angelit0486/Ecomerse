"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { recordSecurityEvent } from "@/server/auth/security-events";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { peekInvitation } from "@/server/invitations/peek";
import { getSession } from "@/server/auth/session";
import { serverEnv } from "@/server/env";
import { workerDb } from "@/server/db/role-clients";
import { clientIpHash } from "@/server/storefront/cart";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * Acceso del staff (GATE0 §7.2, Q-B2): código por email o contraseña (ADR-031)
 * → TOTP obligatorio → AAL2. Sin autorregistro: el staff entra solo por invitación.
 */

export interface FormState {
  error?: string;
  values?: Record<string, string>;
  ok?: boolean;
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

/** Un intento de entrar del staff (código o contraseña): 10 por email y 30 por IP cada 15 min. */
async function takeLoginAttempt(email: string): Promise<boolean> {
  const [attempt] = await workerDb()<{ ok: boolean }[]>`
    select system.take_staff_login_attempt(${email}, ${await clientIpHash()}) as ok`;
  return attempt?.ok === true;
}

export async function requestLoginCode(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!parsed.success) {
    return {
      error: "Escribe un email válido.",
      values: { email: String(formData.get("email") ?? "") },
    };
  }

  // Límite propio por email y por IP también para el código (auditoría SEC-01): los
  // de Supabase Auth son por la IP del servidor, compartida por todo el staff. Se
  // comparte el presupuesto con la contraseña: son intentos de entrar a la misma cuenta.
  if (!(await takeLoginAttempt(parsed.data))) {
    return { error: "Demasiados intentos. Espera unos minutos.", values: { email: parsed.data } };
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false },
  });
  // Cualquier error (email sin cuenta, límite de frecuencia —que Auth solo aplica a
  // cuentas existentes—) se trata igual que un éxito: la respuesta no revela qué
  // emails tienen cuenta.
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
  if (!(await takeLoginAttempt(email))) {
    return { error: "Demasiados intentos. Espera unos minutos y pide un código nuevo." };
  }

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

/** Contraseña del staff (ADR-031): 12 a 72 caracteres (bcrypt corta en 72 bytes). */
const passwordSchema = z
  .string()
  .min(12)
  .refine((p) => new TextEncoder().encode(p).length <= 72)
  .refine((p) => p.trim().length >= 12);

/**
 * Entrar con email y contraseña (ADR-031): la contraseña reemplaza solo al código
 * por email; la sesión queda en aal1 y el TOTP sigue siendo obligatorio.
 */
export async function signInWithPassword(_: FormState, formData: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
  );
  const password = String(formData.get("password") ?? "");
  const values = { email: String(formData.get("email") ?? "") };
  if (!email.success || password.length === 0 || password.length > 200) {
    return { error: "Escribe tu email y tu contraseña.", values };
  }
  // Límite propio por email y por IP: los de Supabase Auth son por la IP del
  // servidor, compartida por todos los inicios de sesión.
  if (!(await takeLoginAttempt(email.data))) {
    return { error: "Demasiados intentos. Espera unos minutos.", values };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password,
  });
  if (error || !data.user) {
    await recordSecurityEvent("auth.login_failed", { metadata: { reason: "invalid_password" } });
    // El mismo mensaje para email sin cuenta y contraseña incorrecta.
    return {
      error:
        error?.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : "El email o la contraseña no son correctos.",
      values,
    };
  }
  await recordSecurityEvent("auth.login_succeeded", {
    userId: data.user.id,
    metadata: { method: "password" },
  });
  redirect("/seguridad/2fa");
}

/** Crear o cambiar la contraseña (ADR-031): solo con la sesión completa (AAL2). */
export async function setPassword(_: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect("/ingresar");
  if (session.aal !== "aal2") redirect("/seguridad/2fa");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!passwordSchema.safeParse(password).success) {
    return { error: "Usa al menos 12 caracteres (máximo 72)." };
  }
  if (password !== confirm) return { error: "Las dos contraseñas no coinciden." };
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (user.user?.email && password.toLowerCase().includes(user.user.email.toLowerCase())) {
    return { error: "La contraseña no puede contener tu email." };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error:
        error.code === "weak_password"
          ? "Esa contraseña es demasiado débil o ya apareció en filtraciones. Elige otra."
          : error.code === "same_password"
            ? "Es la misma contraseña que ya tenías."
            : "No pudimos guardar la contraseña. Inténtalo de nuevo.",
    };
  }
  await recordSecurityEvent("auth.password_set", { userId: session.userId });
  return { ok: true };
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
  // Solo se vuelve a la invitación si sigue vigente; si no, se olvida.
  const cookieStore = await cookies();
  const invitation = cookieStore.get(INVITATION_COOKIE)?.value;
  if (invitation && (await peekInvitation(invitation))) redirect(`/invitacion/${invitation}`);
  if (invitation) cookieStore.delete(INVITATION_COOKIE);
  redirect("/admin");
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
    const result = await callRpc<{ organization_id: string; store_id: string | null }>(
      supabase,
      "access_accept_invitation",
      { p_token: token },
    );
    const stores = await callRpc<{ store_id: string; organization_id: string; handle: string }[]>(
      supabase,
      "access_list_my_stores",
    );
    // Invitación a una tienda: esa tienda. A la organización: su única tienda, si
    // hay una sola (p. ej. el dueño tras el alta asistida).
    const orgStores = stores.filter((s) => s.organization_id === result.organization_id);
    const handle = result.store_id
      ? stores.find((s) => s.store_id === result.store_id)?.handle
      : orgStores.length === 1
        ? orgStores[0]!.handle
        : undefined;
    if (handle) target = `/admin/${handle}`;
  } catch (error) {
    return { error: reportActionError("invitation", error).message };
  }
  (await cookies()).delete(INVITATION_COOKIE);
  redirect(target);
}
