import { randomBytes, randomInt } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTokenResolver,
  credentialContext,
  resealCredentials,
} from "@/server/payments/mercadopago-credentials";
import { open, seal } from "@/server/security/secret-box";

/**
 * Rotación de PAYMENT_CREDENTIALS_KEY contra PostgreSQL real (rol system_worker):
 * con la clave anterior configurada, el servidor sigue cobrando con las llaves
 * viejas, las vuelve a cifrar con la nueva sin que el comercio reconecte, y una
 * segunda pasada no cambia nada.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const run = Math.random().toString(36).slice(2, 8);
const PLATFORM = "APP_USR-0000000000000000-000000-plataforma-000";
const oldKey = randomBytes(32);
const newKey = randomBytes(32);

async function storeWithKeys(tag: string, key: Buffer, refresh: boolean) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('rsl_plan', 'rsl_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values (${`Org ${tag}`}, ${`org-rsl-${tag}-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status)
              values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, ${`Tienda ${tag}`}, ${`rsl-${tag}-${run}`}, 'MXN', 'MX', 'America/Mexico_City')
    returning id`;
  const storeId = s!.id;
  const token = `APP_USR-${randomBytes(12).toString("hex")}`;
  const ctx = credentialContext(storeId);
  const [a] = await admin<{ id: string }[]>`
    select system.mercadopago_attach_oauth(${storeId}::uuid, ${String(randomInt(1e8, 9e8))}, 'test',
      ${seal(key, token, ctx)}, ${refresh ? seal(key, `TG-${tag}`, ctx) : null},
      now() + interval '180 days') as id`;
  return { storeId, accountId: a!.id, token };
}

async function envelopes(accountId: string) {
  const [row] = await admin<{ access: string; refresh: string | null }[]>`
    select access_token_enc as access, refresh_token_enc as refresh
      from system.payment_credentials where payment_account_id = ${accountId}`;
  return row!;
}

describe("rotación de la clave de las llaves de Mercado Pago", () => {
  let a: Awaited<ReturnType<typeof storeWithKeys>>;
  let b: Awaited<ReturnType<typeof storeWithKeys>>;
  let c: Awaited<ReturnType<typeof storeWithKeys>>;

  beforeAll(async () => {
    a = await storeWithKeys("a", oldKey, true);
    b = await storeWithKeys("b", oldKey, false);
    c = await storeWithKeys("c", newKey, true); // conectada después de la rotación
  });

  afterAll(async () => {
    await admin.end();
    await worker.end();
  });

  it("sin la clave anterior, la nueva no abre las llaves viejas", async () => {
    const resolve = createTokenResolver({
      db: worker,
      key: newKey,
      oauth: null,
      platformToken: PLATFORM,
    });
    await expect(resolve({ id: a.accountId } as never)).rejects.toThrow();
  });

  it("con la anterior configurada sigue cobrando y vuelve a cifrar todo con la nueva", async () => {
    const deps = {
      db: worker,
      key: newKey,
      previousKey: oldKey,
      oauth: null,
      platformToken: PLATFORM,
    };
    expect(await createTokenResolver(deps)({ id: a.accountId } as never)).toBe(a.token);

    const first = await resealCredentials(deps, 1); // lotes de 1: recorre la paginación
    expect(first.resealed).toBeGreaterThanOrEqual(2);
    // Otras pruebas comparten la base con llaves de claves al azar: se cuentan aparte.

    for (const s of [a, b, c]) {
      const env = await envelopes(s.accountId);
      expect(open(newKey, env.access, credentialContext(s.storeId))).toBe(s.token);
      if (env.refresh)
        expect(open(newKey, env.refresh, credentialContext(s.storeId))).toMatch(/^TG-/);
    }
    expect((await envelopes(b.accountId)).refresh).toBeNull();

    // Ya sin la clave anterior, la tienda cobra con su llave.
    const resolve = createTokenResolver({ ...deps, previousKey: null });
    expect(await resolve({ id: a.accountId } as never)).toBe(a.token);

    // Repetir no cambia nada.
    const before = await envelopes(a.accountId);
    const second = await resealCredentials(deps);
    expect(second.resealed).toBe(0);
    expect(second.current).toBeGreaterThanOrEqual(3);
    expect(await envelopes(a.accountId)).toEqual(before);
  });

  it("una llave que no abre con ninguna clave se cuenta y no se toca", async () => {
    const stranger = await storeWithKeys("d", randomBytes(32), false);
    const before = await envelopes(stranger.accountId);
    const r = await resealCredentials({ db: worker, key: newKey, previousKey: oldKey });
    expect(r.unreadable).toBeGreaterThanOrEqual(1);
    expect(await envelopes(stranger.accountId)).toEqual(before);
  });
});
