import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDomainHandlers } from "@/server/domains/handlers";
import type { DomainProvider, ProviderState } from "@/server/domains/provider";
import { createLogger } from "@/server/observability/logger";

/**
 * Job domains.verify (E16) de punta a punta, como system_worker, con el DNS y el
 * proveedor simulados: el dominio solo se activa con el TXT correcto y el
 * proveedor listo; sin proveedor configurado se queda en verificación.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });

let storeId = "";
let ownerId = "";
let second = { id: "", token: "" };

async function as<T>(sub: string, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({
      sub,
      role: "authenticated",
      aal: "aal2",
    })}, true), set_config('role', 'authenticated', true)`;
    return fn(sql);
  })) as T;
}

function provider(state: ProviderState, added: string[]): DomainProvider {
  return {
    add: async (hostname) => {
      added.push(hostname);
      return { ref: "prj_test" };
    },
    state: async () => state,
  };
}

async function addDomain(hostname: string): Promise<{ id: string; token: string }> {
  return as(ownerId, async (sql) => {
    const [row] = await sql<{ r: { id: string; token: string } }[]>`
      select public.domains_add_custom(${storeId}, ${hostname}) as r`;
    return row!.r;
  });
}

async function run(id: string, state: ProviderState, txt: string[], added: string[] = []) {
  const [entry] = createDomainHandlers({
    db: worker,
    provider: provider(state, added),
    txt: async (name) => (name.startsWith("_platform-verify.") ? txt : []),
  });
  await entry![1](
    {
      id: "job",
      type: "domains.verify",
      storeId,
      payload: { domain_id: id },
      attempts: 1,
      maxAttempts: 3,
    },
    { log, deadline: Date.now() + 10_000 },
  );
  const [row] = await admin<{ status: string; provider_ref: string | null }[]>`
    select status, provider_ref from public.store_domains where id = ${id}`;
  return row!;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('domains_plan', 'domains_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 2), (${plan!.id}, 'max_staff', 5), (${plan!.id}, 'max_products', 100)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org dominios', 'org-dominios', 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Dominios', 'dominios-it', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  storeId = s!.id;
  const [owner] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), 'owner@dominios.test') returning id`;
  ownerId = owner!.id;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${ownerId}, 'org_owner')`;
});

afterAll(async () => {
  await admin.end();
  await worker.end();
});

describe("domains.verify", () => {
  it("con el TXT correcto y el proveedor listo, se activa", async () => {
    const { id, token } = await addDomain("www.dominio-uno.mx");
    const added: string[] = [];
    expect(await run(id, "pending", [token], added)).toMatchObject({
      status: "verifying",
      provider_ref: "prj_test",
    });
    expect(added).toEqual(["www.dominio-uno.mx"]);
    expect((await run(id, "ready", [`"${token}"`])).status).toBe("active");
  });

  it("con otro TXT o sin proveedor configurado, sigue en verificación y se reprograma", async () => {
    second = await addDomain("www.dominio-dos.mx");
    const { id, token } = second;
    expect((await run(id, "ready", ["pruva-otro"])).status).toBe("verifying");
    expect((await run(id, "not_configured", [token])).status).toBe("verifying");
    const [jobs] = await admin<{ n: number }[]>`
      select count(*)::int as n from system.jobs
       where type = 'domains.verify' and payload ->> 'domain_id' = ${id} and run_after > now()`;
    expect(jobs!.n).toBeGreaterThan(0);
  });

  it("un dominio quitado ya no se revisa", async () => {
    await as(ownerId, (sql) => sql`select public.domains_remove(${storeId}, ${second.id})`);
    expect((await run(second.id, "ready", [second.token])).status).toBe("removed");
  });
});
