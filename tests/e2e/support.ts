import { randomBytes } from "node:crypto";

import { expect, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

import { totp } from "../support/totp";

/** Utilidades E2E contra el stack local (solo desarrollo y CI). */
export const API = process.env.STACK_API_URL ?? "http://127.0.0.1:54321";
export const MAIL = process.env.STACK_MAIL_URL ?? "http://127.0.0.1:8025";
export const admin = postgres(
  process.env.STACK_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pruva_dev",
  // Compartido por todos los specs del worker: se cierra solo al quedar inactivo.
  { max: 2, idle_timeout: 2, onnotice: () => {} },
);

export const uniq = () => randomBytes(4).toString("hex");

/** Clave service_role del stack local (`pnpm stack env`); solo para preparar datos. */
function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY: carga `pnpm stack env` en el entorno.");
  return key;
}

/** Crea un usuario confirmado con la Admin API de Supabase Auth (como hace la plataforma). */
export async function createAuthUser(email: string): Promise<string> {
  const response = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey(),
      authorization: `Bearer ${serviceRoleKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`createAuthUser ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

/** Organización + suscripción activa + tienda, con `ownerId` como org_owner. */
export async function createTenant(key: string, ownerId: string) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('e2e_plan', 'e2e_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 20)
              on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values (${`Org ${key}`}, ${`org-${key}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status)
              values (${org!.id}, ${plan!.id}, 'active')`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${ownerId}, 'org_owner')`;
  const name = `Tienda ${key.toUpperCase()}`;
  const [store] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, ${name}, ${`t${key}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  return { orgId: org!.id, storeId: store!.id, name, handle: `t${key}` };
}

/** Último código de 6 dígitos enviado a `email` (Mailpit). */
export async function readEmailCode(email: string, after = 0): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string; Created: string }[] };
    const fresh = messages.find((m) => Date.parse(m.Created) >= after);
    if (fresh) {
      const message = await fetch(`${MAIL}/api/v1/message/${fresh.ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const code = /\b(\d{6})\b/u.exec(Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No llegó el código a ${email}`);
}

export async function emailCount(email: string): Promise<number> {
  const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  return ((await res.json()) as { messages: unknown[] }).messages.length;
}

// -----------------------------------------------------------------------------
// Flujos de navegador reutilizables
// -----------------------------------------------------------------------------

const usedTotp = new Set<string>();

/** Código TOTP de una ventana aún no usada en esta ejecución (Auth rechaza reusos). */
export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const code = totp(secret);
    const key = `${secret}:${code}`;
    if (!usedTotp.has(key)) {
      usedTotp.add(key);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Desde /ingresar/codigo: escribe el código del email y llega a /seguridad/2fa. */
export async function enterEmailCode(page: Page, email: string, sentAfter: number) {
  await expect(page).toHaveURL(/\/ingresar\/codigo$/);
  await page.getByLabel("Código").fill(await readEmailCode(email, sentAfter));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/seguridad\/2fa$/);
}

/** En /seguridad/2fa sin factor: activa TOTP y devuelve la clave. */
export async function enrollTotp(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Activar verificación en dos pasos" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Código de la app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Activar y entrar" }).click();
  return secret;
}

/** Acceso completo de un staff nuevo (código por email + enrolamiento TOTP). */
export async function loginNewStaff(page: Page, email: string): Promise<string> {
  const sentAt = Date.now() - 1000;
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await enterEmailCode(page, email, sentAt);
  const secret = await enrollTotp(page);
  await expect(page).toHaveURL(/\/admin$/);
  return secret;
}

/** Access token de la sesión de Supabase guardada en las cookies (@supabase/ssr). */
export async function accessTokenFrom(context: BrowserContext): Promise<string> {
  const cookies = (await context.cookies()).filter((c) =>
    /^sb-.+-auth-token(\.\d+)?$/.test(c.name),
  );
  cookies.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const raw = cookies.map((c) => decodeURIComponent(c.value)).join("");
  const json = raw.startsWith("base64-")
    ? Buffer.from(raw.slice("base64-".length), "base64url").toString()
    : raw;
  return (JSON.parse(json) as { access_token: string }).access_token;
}

/** Ejecuta el runner de jobs de la app como lo hace Vercel Cron. */
export async function runJobs(baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000") {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Falta CRON_SECRET (el mismo que usa la app).");
  const response = await fetch(`${baseUrl}/api/jobs/run`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error(`runner ${response.status}`);
}

/** Enlace de invitación del último email recibido por `email`. */
export async function readInvitationLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages[0]) {
      const message = await fetch(`${MAIL}/api/v1/message/${messages[0].ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const link = /(https?:\/\/\S+\/invitacion\/[0-9a-f]{64})/.exec(Text)?.[1];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No llegó la invitación a ${email}`);
}
