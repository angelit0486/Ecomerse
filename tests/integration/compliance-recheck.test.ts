import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createComplianceHandlers } from "@/server/compliance/handlers";
import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createLogger } from "@/server/observability/logger";

/**
 * Job compliance.recheck (ADR-021) de punta a punta, como system_worker: un cambio
 * de reglas de la plataforma despublica lo que deja de cumplir (denegación por
 * defecto) y avisa a la caché de la tienda.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const store = createPostgresJobStore(worker);
const log = createLogger({ sink: () => {} });

let storeId = "";
let ownerId = "";
let adminId = "";
let profileId = "";

/** Como PostgREST: claims del JWT y rol authenticated, en una transacción. */
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

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('compliance_plan', 'compliance_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 2), (${plan!.id}, 'max_staff', 5), (${plan!.id}, 'max_products', 100)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org suplementos', 'org-suplementos', 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Suplementos', 'suplementos-it', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  storeId = s!.id;
  const [owner] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), 'owner@suplementos.test') returning id`;
  ownerId = owner!.id;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${ownerId}, 'org_owner')`;
  const [staff] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), 'admin@plataforma.test') returning id`;
  adminId = staff!.id;
  await admin`insert into public.platform_staff (user_id, role) values (${adminId}, 'platform_admin')`;
  const [profile] = await admin<{ id: string }[]>`
    select id from public.compliance_profiles where country = 'MX' and category_key = 'dietary_supplement'`;
  profileId = profile!.id;
});

afterAll(async () => {
  // El perfil es de la plataforma: se deja como lo dejó la migración.
  await admin`delete from public.compliance_rules where profile_id = ${profileId}`;
  await admin`update public.compliance_profiles
                 set status = 'pending', reviewed_by = null, reviewed_at = null, review_notes = null
               where id = ${profileId}`;
  await Promise.all([admin.end(), worker.end()]);
});

describe("compliance.recheck", () => {
  it("una regla nueva despublica el suplemento que ya no cumple y avisa a la caché", async () => {
    await as(adminId, async (sql) => {
      await sql`select public.platform_compliance_rule_save(${profileId}, ${sql.json({
        kind: "required_field",
        key: "ingredientes",
        label: "Ingredientes",
        field_key: "ingredients",
      })})`;
      await sql`select public.platform_compliance_profile_set_status(${profileId}, 'active', 'Asesoría de prueba', null)`;
    });
    const productId = await as(ownerId, async (sql) => {
      await sql`select public.compliance_set_store_category(${storeId}, 'dietary_supplement', true)`;
      const [p] = await sql<{ product: { id: string } }[]>`
        select public.catalog_upsert_product(${storeId}, ${sql.json({
          title: "Omega 3",
          slug: "omega-3",
          variants: [{ price: 29900 }],
        })}) as product`;
      const id = p!.product.id;
      await sql`select public.catalog_save_regulatory_info(${storeId}, ${id}, 'dietary_supplement',
                                                           ${sql.json({ ingredients: "Aceite de pescado" })})`;
      await sql`select public.catalog_publish_product(${storeId}, ${id})`;
      return id;
    });
    // El runner toma cualquier job en cola: los de otros archivos (p. ej. order.created
    // de checkout-concurrency, según el orden en que Vitest corra los archivos) no son
    // de esta prueba y morirían por no tener handler aquí.
    await admin`delete from system.jobs where status = 'queued' or type = 'compliance.recheck'`;

    // La plataforma agrega un campo obligatorio que el producto no tiene.
    await as(adminId, async (sql) => {
      await sql`select public.platform_compliance_rule_save(${profileId}, ${sql.json({
        kind: "required_field",
        key: "advertencias",
        label: "Advertencias",
        field_key: "warnings",
      })})`;
    });
    const invalidated: string[] = [];
    const summary = await runJobs({
      store,
      registry: new Map(
        createComplianceHandlers({ db: worker, onUnpublished: (id) => invalidated.push(id) }),
      ),
      workerId: "test-compliance",
      log,
      deadlineMs: 30_000,
      hardDeadlineMs: 40_000,
    });
    expect(summary).toMatchObject({ succeeded: 1, retried: 0, dead: 0 });
    const [product] = await admin<
      { status: string }[]
    >`select status from public.products where id = ${productId}`;
    expect(product!.status).toBe("draft");
    expect(invalidated).toEqual([storeId]);
    const [audit] = await admin<{ reason: string; codes: string[] }[]>`
      select reason, metadata -> 'codes' as codes from audit.audit_logs
       where action = 'product.unpublished' and entity_id = ${productId}`;
    expect(audit).toEqual({ reason: "compliance", codes: ["compliance_field_missing:warnings"] });
  });

  it("un término prohibido nuevo oculta la sección de la portada que lo usa (F9 §13 M1)", async () => {
    const sectionId = "00000000-0000-4000-8000-0000000000a1";
    await as(ownerId, async (sql) => {
      const [t] = await sql<{ rev: number }[]>`
        select coalesce((select draft_revision from public.store_themes where store_id = ${storeId}), 0) as rev`;
      const rev = await sql<{ r: number }[]>`
        select public.appearance_save_home_draft(${storeId}, ${sql.json([
          {
            id: sectionId,
            type: "rich_text",
            enabled: true,
            props: { html: "<p>Recupera tu energía con constancia</p>" },
          },
        ])}, ${t!.rev}) as r`;
      await sql`select public.appearance_publish_theme(${storeId}, ${rev[0]!.r})`;
    });
    await admin`delete from system.jobs where status = 'queued' or type = 'compliance.recheck'`;
    await as(adminId, async (sql) => {
      await sql`select public.platform_compliance_rule_save(${profileId}, ${sql.json({
        kind: "forbidden_term",
        key: "no_constancia",
        label: "Prueba",
        body: "constancia",
      })})`;
    });
    const invalidated: string[] = [];
    const summary = await runJobs({
      store,
      registry: new Map(
        createComplianceHandlers({ db: worker, onUnpublished: (id) => invalidated.push(id) }),
      ),
      workerId: "test-compliance-home",
      log,
      deadlineMs: 30_000,
      hardDeadlineMs: 40_000,
    });
    expect(summary).toMatchObject({ succeeded: 1, retried: 0, dead: 0 });
    const [theme] = await admin<{ enabled: boolean }[]>`
      select (home_sections -> 0 ->> 'enabled')::boolean as enabled
        from public.store_themes where store_id = ${storeId}`;
    expect(theme!.enabled).toBe(false);
    expect(invalidated).toContain(storeId);
  });
});
