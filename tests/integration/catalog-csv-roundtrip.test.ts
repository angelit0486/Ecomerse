import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/csv-parse";
import { exportCsv } from "@/server/exports/csv-export";
import { checkHeaders, planProductImport } from "@/server/imports/products";

/**
 * R-T05: ida y vuelta del CSV de productos con la ficha sanitaria y los
 * atributos. Se exporta con las mismas piezas que el panel (exports_rows +
 * exportCsv), se vuelve a importar (parseCsv + planProductImport + imports_create
 * + system.import_commit) y la ficha y los atributos quedan idénticos.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});

let storeId = "";
let ownerId = "";
let productId = "";

/** Ejecuta como la dueña (rol authenticated con aal2), igual que el panel. */
function asOwner<T>(work: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql);
  }) as Promise<T>;
}

async function snapshot() {
  const [info] = await admin<{ category_key: string | null; data: unknown }[]>`
    select category_key, data from public.product_regulatory_info where product_id = ${productId}`;
  const values = await admin<{ key: string }[]>`
    select a.key || ':' || av.key as key from public.product_attribute_values pav
      join public.attribute_values av on av.id = pav.value_id
      join public.attributes a on a.id = av.attribute_id
     where pav.product_id = ${productId} order by 1`;
  return { info, attributes: values.map((v) => v.key) };
}

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('csv_plan', 'csv_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 100)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org CSV', ${`org-csv-${suffix}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda CSV', ${`csv-${suffix}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  const [u] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), ${`owner-${suffix}@csv.test`}) returning id`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${u!.id}, 'org_owner')`;
  storeId = s!.id;
  ownerId = u!.id;

  productId = await asOwner(async (sql) => {
    await sql`select public.compliance_set_store_category(${storeId}, 'dietary_supplement', true)`;
    await sql`select public.catalog_save_attribute(${storeId}, ${sql.json({
      name: "Objetivo",
      values: [{ label: "Energía" }, { label: "Corazón" }, { label: "Sueño" }],
    })})`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${storeId}, ${sql.json({
        title: "Omega 3",
        slug: "omega-3",
        variants: [{ price: 29900, sku: "OMG-60" }],
      })}) as r`;
    const id = p!.r.id;
    await sql`select public.catalog_save_regulatory_info(${storeId}, ${id}, 'dietary_supplement', ${sql.json(
      {
        form: "Cápsulas blandas",
        servings_per_container: 60,
        ingredients: "Aceite de pescado; gelatina, glicerina",
        nutrition: [
          { name: "Omega 3", amount: "1000", unit: "mg" },
          { name: "EPA", amount: "180", unit: "mg", dv: "10%" },
          { name: "DHA", amount: "120" },
        ],
        warnings: "Línea 1\nLínea 2 con «comillas» y, comas",
      },
    )})`;
    const ids = await sql<{ id: string }[]>`
      select av.id from public.attribute_values av join public.attributes a on a.id = av.attribute_id
       where a.store_id = ${storeId} and av.key in ('energia', 'corazon')`;
    await sql`select public.catalog_set_product_attributes(${storeId}, ${id}, ${ids.map((r) => r.id)}::uuid[])`;
    return id;
  });
});

afterAll(async () => {
  await admin.end();
  await worker.end();
});

describe("CSV de productos con ficha y atributos", () => {
  it("lo exportado se vuelve a importar igual", async () => {
    const before = await snapshot();
    const exported = await asOwner(async (sql) => {
      const [r] = await sql<
        {
          v: {
            rows: Record<string, unknown>[];
            pii: boolean;
            regulated: boolean;
            has_attributes: boolean;
          };
        }[]
      >`
        select public.exports_rows(${storeId}, 'products') as v`;
      return r!.v;
    });
    expect(exported.regulated && exported.has_attributes).toBe(true);
    const csv = exportCsv("products", exported.rows, exported.pii, {
      regulated: exported.regulated,
      attributes: exported.has_attributes,
    });
    expect(csv).toContain("Omega 3|1000|mg; EPA|180|mg|10%; DHA|120");
    expect(csv).toContain("objetivo:energia|corazon");

    // Se cambia todo en la tienda; la importación del archivo debe dejarlo como estaba.
    await asOwner(async (sql) => {
      await sql`select public.catalog_save_regulatory_info(${storeId}, ${productId}, 'dietary_supplement',
                  ${sql.json({ ingredients: "Otra cosa" })})`;
      await sql`select public.catalog_set_product_attributes(${storeId}, ${productId}, '{}'::uuid[])`;
    });

    const parsed = parseCsv(csv);
    const headers = checkHeaders(parsed.headers);
    if (!headers.ok) throw new Error("encabezados");
    const plan = planProductImport(parsed.headers, parsed.rows, parsed.rowNumbers);
    expect(plan.flatMap((r) => r.errors)).toEqual([]);

    const job = await asOwner(async (sql) => {
      const [j] = await sql<{ id: string }[]>`
        select public.imports_create(${storeId}, 'update_existing', 'ida-y-vuelta.csv', ${headers.columns}::text[],
                                     ${headers.ignored}::text[], ${sql.json(plan as unknown as postgres.JSONValue)}) as id`;
      const errors = await sql<{ e: string }[]>`
        select jsonb_array_elements_text(errors) as e from public.import_job_rows where import_job_id = ${j!.id}`;
      expect(errors.map((r) => r.e)).toEqual([]);
      await sql`select public.imports_commit(${storeId}, ${j!.id})`;
      return j!.id;
    });
    const [result] = await worker<
      { r: { status: string } }[]
    >`select system.import_commit(${job}) as r`;
    expect(result!.r.status).toBe("completed");
    expect(await snapshot()).toEqual(before);
  });
});
