import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * CAP-11 (Orden 06): el límite de variantes por producto se cuenta con la fila
 * del producto bloqueada (ya no con un candado de aviso). Dos sesiones que
 * agregan una variante al mismo producto a la vez deben seguir en fila: la
 * segunda espera a la primera y ve su variante.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
let storeId = "";
let productId = "";

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('variant_lock_plan', 'variant_lock_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100),
                     (${plan!.id}, 'max_variants_per_product', 2)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org candado', 'org-variant-lock', 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [store] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda candado', 'variant-lock', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  storeId = store!.id;
  const [product] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug) values (${storeId}, 'Con límite', 'con-limite') returning id`;
  productId = product!.id;
  const [option] = await admin<{ id: string }[]>`
    insert into public.product_options (store_id, product_id, name, position) values (${storeId}, ${productId}, 'Talla', 0) returning id`;
  for (const [i, value] of ["CH", "M", "G"].entries()) {
    await admin`insert into public.product_option_values (store_id, option_id, value, position)
                values (${storeId}, ${option!.id}, ${value}, ${i})`;
  }
  await admin.begin((sql) => variant(sql, "CH"));
});
afterAll(async () => {
  await admin.end();
});

/** Alta directa de una variante con su valor de opción (como hace catalog_upsert_product). */
async function variant(sql: postgres.TransactionSql, size: string) {
  const [v] = await sql<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, price, option_signature)
    values (${storeId}, ${productId}, 100, ${`Talla=${size}`}) returning id`;
  await sql`insert into public.variant_option_values (variant_id, option_value_id, option_id, store_id)
            select ${v!.id}, ov.id, ov.option_id, ov.store_id from public.product_option_values ov
              join public.product_options o on o.id = ov.option_id
             where o.product_id = ${productId} and ov.value = ${size}`;
}

describe("límite de variantes con dos sesiones a la vez", () => {
  it("la segunda espera a la primera y, con el límite lleno, se rechaza", async () => {
    let releaseFirst!: () => void;
    const hold = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstInserted!: () => void;
    const inserted = new Promise<void>((resolve) => (firstInserted = resolve));

    const first = admin.begin(async (sql) => {
      await variant(sql, "M"); // 2 de 2
      firstInserted();
      await hold; // mantiene la transacción abierta
    });
    await inserted;

    let secondSettled = false;
    const second = admin
      .begin(async (sql) => {
        await variant(sql, "G"); // sería la 3.ª
      })
      .then(
        () => "ok",
        (error: { message: string }) => error.message,
      )
      .finally(() => {
        secondSettled = true;
      });

    // Mientras la primera no termina, la segunda está esperando (ni pasó ni falló).
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(secondSettled).toBe(false);

    releaseFirst();
    await first;
    expect(await second).toBe("limit_reached");
    const [count] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.product_variants where product_id = ${productId} and deleted_at is null`;
    expect(count!.n).toBe(2);
  }, 30_000);
});
