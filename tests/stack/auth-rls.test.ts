import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEV_ANON_KEY, signDevJwt } from "../../scripts/dev/keys.mjs";
import { totp } from "../support/totp";

/**
 * Spike S-6 (decisión A-03): Supabase Auth real (GoTrue) + PostgREST + nuestras
 * migraciones, sin Docker. Prueba de extremo a extremo de CF-02 (AAL2 en la base)
 * y del aislamiento entre tiendas a través de la Data API.
 * Requiere `bash scripts/dev/stack.sh up`.
 */
const API = process.env.STACK_API_URL ?? "http://127.0.0.1:54321";
const MAIL = process.env.STACK_MAIL_URL ?? "http://127.0.0.1:8025";
const adminUrl =
  process.env.STACK_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pruva_dev";

const admin = postgres(adminUrl, { max: 2, onnotice: () => {} });
const run = randomBytes(4).toString("hex");

type Json = Record<string, unknown>;

async function api(path: string, init: { method?: string; token?: string; body?: Json } = {}) {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      apikey: DEV_ANON_KEY,
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
}

function claims(token: string): Json {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Json;
}

async function readOtp(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = await fetch(`${MAIL}/api/v1/message/${messages[0]!.ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const code = /\b(\d{6})\b/u.exec(Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No llegó el código a ${email}`);
}

async function signInWithOtp(email: string) {
  const sent = await api("/auth/v1/otp", { body: { email, create_user: true } });
  expect(sent.status).toBe(200);
  const token = await readOtp(email);
  const verified = await api("/auth/v1/verify", { body: { type: "email", email, token } });
  expect(verified.status).toBe(200);
  const body = verified.body as { access_token: string; user: { id: string } };
  return { accessToken: body.access_token, userId: body.user.id };
}

async function createTenant(key: string, ownerId: string) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('stack_test', 'stack_test')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`
    insert into public.plan_entitlements (plan_id, key, value_int)
    values (${plan!.id}, 'max_stores', 3), (${plan!.id}, 'max_staff', 20)
    on conflict (plan_id, key) do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values (${`Org ${key}`}, ${`org-${key}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status)
              values (${org!.id}, ${plan!.id}, 'active')`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${ownerId}, 'org_owner')`;
  const [store] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, ${`Tienda ${key}`}, ${`tienda-${key}`}, 'MXN', 'MX', 'America/Mexico_City')
    returning id`;
  return { orgId: org!.id, storeId: store!.id };
}

let owner: { accessToken: string; userId: string };
let aal2Token: string;
let own: { orgId: string; storeId: string };
let foreign: { orgId: string; storeId: string };

beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error("Stack local apagado. Ejecuta `bash scripts/dev/stack.sh up`.");
});

afterAll(async () => {
  await admin.end();
});

describe("stack local: Supabase Auth + PostgREST + RLS", () => {
  it("login sin contraseña: el código llega por correo y da una sesión aal1", async () => {
    owner = await signInWithOtp(`dueno-${run}@example.test`);
    const c = claims(owner.accessToken);
    expect(c.aal).toBe("aal1");
    expect(c.role).toBe("authenticated");
    expect(c.sub).toBe(owner.userId);
  });

  it("el trigger de auth.users crea el perfil y RLS lo muestra solo a su dueño", async () => {
    const profiles = await api("/rest/v1/profiles?select=id", { token: owner.accessToken });
    expect(profiles.status).toBe(200);
    expect(profiles.body).toEqual([{ id: owner.userId }]);
  });

  it("con aal1 el dueño NO ve su tienda (CF-02: staff exige AAL2 en la base)", async () => {
    const other = await signInWithOtp(`ajeno-${run}@example.test`);
    own = await createTenant(`a${run}`, owner.userId);
    foreign = await createTenant(`b${run}`, other.userId);
    const stores = await api("/rest/v1/stores?select=id", { token: owner.accessToken });
    expect(stores.status).toBe(200);
    expect(stores.body).toEqual([]);
  });

  it("TOTP eleva la sesión a aal2", async () => {
    const enrolled = await api("/auth/v1/factors", {
      token: owner.accessToken,
      body: { factor_type: "totp", friendly_name: `app-${run}` },
    });
    expect(enrolled.status).toBe(200);
    const factor = enrolled.body as { id: string; totp: { secret: string } };

    const challenge = await api(`/auth/v1/factors/${factor.id}/challenge`, {
      token: owner.accessToken,
      body: {},
    });
    expect(challenge.status).toBe(200);
    const verified = await api(`/auth/v1/factors/${factor.id}/verify`, {
      token: owner.accessToken,
      body: { challenge_id: (challenge.body as { id: string }).id, code: totp(factor.totp.secret) },
    });
    expect(verified.status).toBe(200);
    aal2Token = (verified.body as { access_token: string }).access_token;
    expect(claims(aal2Token).aal).toBe("aal2");
  });

  it("con aal2 ve su tienda y solo la suya", async () => {
    const stores = await api("/rest/v1/stores?select=id", { token: aal2Token });
    expect(stores.status).toBe(200);
    expect(stores.body).toEqual([{ id: own.storeId }]);

    const direct = await api(`/rest/v1/stores?select=id&id=eq.${foreign.storeId}`, {
      token: aal2Token,
    });
    expect(direct.body).toEqual([]);
  });

  it("RPC de equipo por la Data API contra el auth.users real de Supabase Auth", async () => {
    const team = await api("/rest/v1/rpc/access_list_store_members", {
      token: aal2Token,
      body: { p_store_id: own.storeId },
    });
    expect(team.status).toBe(200);
    expect(team.body).toMatchObject([
      { user_id: owner.userId, email: `dueno-${run}@example.test`, role_key: "org_owner" },
    ]);

    const foreignTeam = await api("/rest/v1/rpc/access_list_store_members", {
      token: aal2Token,
      body: { p_store_id: foreign.storeId },
    });
    expect(foreignTeam.status).toBe(403);
  });

  it("contexto de tienda por request: permisos en vivo, nunca en el JWT", async () => {
    const ctx = await api("/rest/v1/rpc/access_store_context", {
      token: aal2Token,
      body: { p_handle: `tienda-a${run}` },
    });
    expect(ctx.status).toBe(200);
    const body = ctx.body as { store: { id: string }; permissions: string[]; org_role: string };
    expect(body.store.id).toBe(own.storeId);
    expect(body.org_role).toBe("org_owner");
    expect(body.permissions).toContain("staff.manage");
    expect(JSON.stringify(claims(aal2Token))).not.toContain("staff.manage");

    const aal1 = await api("/rest/v1/rpc/access_store_context", {
      token: owner.accessToken,
      body: { p_handle: `tienda-a${run}` },
    });
    expect(aal1.status).toBe(403);
    expect((aal1.body as { message: string }).message).toBe("mfa_required");

    const foreignCtx = await api("/rest/v1/rpc/access_store_context", {
      token: aal2Token,
      body: { p_handle: `tienda-b${run}` },
    });
    expect((foreignCtx.body as { message: string }).message).toBe("not_found");
  });

  it("no puede modificar la tienda ajena (0 filas, sin error que filtre su existencia)", async () => {
    const response = await fetch(`${API}/rest/v1/stores?id=eq.${foreign.storeId}`, {
      method: "PATCH",
      headers: {
        apikey: DEV_ANON_KEY,
        authorization: `Bearer ${aal2Token}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify({ name: "Secuestrada" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    const [row] = await admin<
      { name: string }[]
    >`select name from public.stores where id = ${foreign.storeId}`;
    expect(row!.name).toBe(`Tienda b${run}`);
  });

  it("anon no lee tablas de tienda", async () => {
    const stores = await api("/rest/v1/stores?select=id");
    expect(stores.status).toBe(401);
  });

  it("un JWT firmado con otro secreto se rechaza", async () => {
    const forged = signDevJwt(
      { ...claims(aal2Token), sub: owner.userId },
      "otro-secreto-que-no-es-el-del-servidor-0000",
    );
    const stores = await api("/rest/v1/stores?select=id", { token: forged });
    expect(stores.status).toBe(401);
  });

  it("un aal2 autofirmado sin la firma del servidor no sirve para escalar", async () => {
    const forged = signDevJwt(
      { ...claims(owner.accessToken), aal: "aal2" },
      "otro-secreto-que-no-es-el-del-servidor-0000",
    );
    const stores = await api("/rest/v1/stores?select=id", { token: forged });
    expect(stores.status).toBe(401);
  });

  it("las tablas internas no están expuestas en la Data API", async () => {
    for (const path of ["/rest/v1/jobs", "/rest/v1/audit_logs", "/rest/v1/store_counters"]) {
      const response = await api(`${path}?select=*`, { token: aal2Token });
      expect(response.status, path).toBeGreaterThanOrEqual(400);
    }
  });
});
