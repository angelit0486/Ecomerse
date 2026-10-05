import { randomBytes } from "node:crypto";

import postgres from "postgres";

/** Utilidades E2E contra el stack local (solo desarrollo y CI). */
export const API = process.env.STACK_API_URL ?? "http://127.0.0.1:54321";
export const MAIL = process.env.STACK_MAIL_URL ?? "http://127.0.0.1:8025";
export const admin = postgres(
  process.env.STACK_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pruva_dev",
  { max: 2, onnotice: () => {} },
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
