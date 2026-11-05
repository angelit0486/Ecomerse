import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STORE_TEMPLATES, templatePayload } from "@/lib/templates/store-templates";

/**
 * Plantillas de tienda contra PostgreSQL real (plan 2026-11-05, fase A): cada
 * plantilla se aplica como la dueña con `store_apply_template`, la misma función
 * que usa el panel. La base valida el tema campo por campo, el contraste, los
 * límites y los productos; esta prueba confirma que NINGUNA plantilla del código
 * tiene algo que la base rechace (las pruebas unitarias solo conocen el esquema
 * de Zod, no las reglas de la base).
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const run = Math.random().toString(36).slice(2, 8);
let ownerId = "";
let orgId = "";
let counter = 0;

/** Ejecuta como la dueña (rol authenticated con aal2), igual que el panel. */
function asOwner<T>(work: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql);
  }) as Promise<T>;
}

/** Una tienda nueva y sin lanzar por plantilla: aplicar una exige que no esté publicada. */
async function newStore(): Promise<string> {
  counter += 1;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${orgId}, ${`Tienda plantilla ${counter}`}, ${`tpl-${run}-${counter}`}, 'MXN', 'MX', 'America/Mexico_City')
    returning id`;
  await admin`insert into public.store_themes (store_id) values (${s!.id}) on conflict do nothing`;
  return s!.id;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('tpl_plan', 'tpl_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 40), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 1000)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values ('Org plantillas', ${`org-tpl-${run}`}, 'MX') returning id`;
  orgId = org!.id;
  await admin`insert into public.subscriptions (organization_id, plan_id, status)
              values (${orgId}, ${plan!.id}, 'active')`;
  const [u] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), ${`owner-${run}@tpl.test`}) returning id`;
  ownerId = u!.id;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${orgId}, ${ownerId}, 'org_owner')`;
});

afterAll(async () => {
  await admin.end();
});

describe("plantillas de tienda en la base real", () => {
  it.each(STORE_TEMPLATES.map((t) => [t.key, t] as const))(
    "%s: la base la acepta y deja tema, portada, categorías y productos",
    async (_, template) => {
      const storeId = await newStore();
      const payload = templatePayload(template);
      const result = await asOwner(async (sql) => {
        const [theme] = await sql<{ rev: number }[]>`
          select coalesce(t.draft_revision, 0) as rev from public.store_themes t where t.store_id = ${storeId}`;
        const [r] = await sql<{ r: { products: number; skipped: number } }[]>`
          select public.store_apply_template(${storeId}, ${sql.json(payload as never)}, ${theme?.rev ?? 0}) as r`;
        return r!.r;
      });
      expect(result.products).toBe(template.products.length);
      expect(result.skipped).toBe(0);

      const [counts] = await admin<{ cats: number; prods: number; samples: number }[]>`
        select (select count(*)::int from public.categories c where c.store_id = ${storeId}) as cats,
               (select count(*)::int from public.products p where p.store_id = ${storeId} and p.deleted_at is null) as prods,
               (select count(*)::int from public.products p
                 where p.store_id = ${storeId} and 'ejemplo' = any (p.tags)) as samples`;
      expect(counts).toEqual({
        cats: template.categories.length,
        prods: template.products.length,
        samples: template.products.length,
      });
      const [saved] = await admin<{ sections: number; typography: string | null }[]>`
        select coalesce(jsonb_array_length(t.draft_home_sections), 0)::int as sections,
               t.draft_settings -> 'typography' ->> 'heading' as typography
          from public.store_themes t where t.store_id = ${storeId}`;
      expect(saved?.sections).toBe(template.home_sections.length);
      expect(saved?.typography ?? null).toBe(template.settings.typography?.heading ?? null);
    },
  );

  it("una plantilla no se aplica a una tienda ya publicada", async () => {
    const storeId = await newStore();
    await admin`update public.stores set status = 'active', launched_at = now() where id = ${storeId}`;
    const template = STORE_TEMPLATES.find((t) => t.key === "joyeria")!;
    await expect(
      asOwner(
        (sql) =>
          sql`select public.store_apply_template(${storeId}, ${sql.json(templatePayload(template) as never)}, 0)`,
      ),
    ).rejects.toMatchObject({ message: "validation_failed" });
  });
});
