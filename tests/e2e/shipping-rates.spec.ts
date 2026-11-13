import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * Hallazgo del ensayo O10-01 y corrección D2 (Orden 10, mensaje 4): la tarifa
 * creada desde el panel quedaba inactiva aunque «Activa» estuviera marcada (el
 * campo oculto «0» va antes que la casilla y se leía solo el primer valor).
 * Aquí se sigue la tarifa de punta a punta: panel → base → checkout → pedido,
 * y se comprueba que guardar una tarifa que ya existía no la apaga.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `tarifas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
const origin = () => `http://${tenant.handle}.localhost:3000`;

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

const rate = async (name: string) => {
  const [row] = await admin<{ id: string; is_active: boolean; price: string }[]>`
    select r.id, r.is_active, r.price from public.shipping_rates r
     where r.store_id = ${tenant.storeId} and r.name = ${name}`;
  return row;
};

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`tr${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await asOwner(async (sql) => {
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Taza de barro",
        variants: [{ price: 25000, sku: `TR-${run}`, weight_g: 400 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`TR-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 20, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
  });
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name)
              values (${tenant.storeId}, 'fake', 'active', 'Tarjeta (prueba)')`;
  await admin`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
              on conflict (key) do nothing`;
});

test("la tarifa nueva queda activa y la casilla «Activa» la enciende y apaga", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/envios`);
  await page.getByRole("textbox", { name: "Nombre de la zona", exact: true }).fill("México");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la zona México" })).toBeVisible();

  const nueva = page.locator("form").filter({
    has: page.getByRole("button", { name: "Agregar tarifa" }),
  });
  await nueva.getByRole("textbox", { name: "Nombre de la tarifa", exact: true }).fill("Estándar");
  await nueva.getByRole("textbox", { name: /^Precio/ }).fill("99");
  await expect(nueva.getByRole("checkbox", { name: "Activa" })).toBeChecked();
  await nueva.getByRole("button", { name: "Agregar tarifa" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la tarifa Estándar" })).toBeVisible();
  // Persistencia: la base la guardó activa y con su precio en centavos.
  expect(await rate("Estándar")).toMatchObject({ is_active: true, price: "9900" });

  // Apagarla y volver a encenderla desde su propio formulario.
  const guardada = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Nombre de la tarifa Estándar" }),
  });
  await guardada.getByRole("checkbox", { name: "Activa" }).uncheck();
  await guardada.getByRole("button", { name: "Guardar tarifa" }).click();
  await expect.poll(async () => (await rate("Estándar"))?.is_active).toBe(false);
  await page.reload();
  await expect(guardada.getByRole("checkbox", { name: "Activa" })).not.toBeChecked();
  await guardada.getByRole("checkbox", { name: "Activa" }).check();
  await guardada.getByRole("button", { name: "Guardar tarifa" }).click();
  await expect.poll(async () => (await rate("Estándar"))?.is_active).toBe(true);
  await expectNoSeriousA11yViolations(page);

  // Regresión: una tarifa que ya existía (creada fuera del formulario, como las de
  // plantillas o las de antes de la corrección) se guarda sin tocar «Activa».
  const [zone] = await admin<{ id: string }[]>`
    select id from public.shipping_zones where store_id = ${tenant.storeId} and name = 'México'`;
  await asOwner(
    (sql) =>
      sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
        zone_id: zone!.id,
        name: "Mensajería",
        type: "flat",
        price: 14900,
        est_days_min: 1,
        est_days_max: 2,
      })})`,
  );
  expect(await rate("Mensajería")).toMatchObject({ is_active: true });

  await page.reload();
  const existente = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Nombre de la tarifa Mensajería" }),
  });
  await expect(existente.getByRole("checkbox", { name: "Activa" })).toBeChecked();
  await existente.getByRole("textbox", { name: /^Precio/ }).fill("139");
  await existente.getByRole("button", { name: "Guardar tarifa" }).click();
  await expect.poll(async () => (await rate("Mensajería"))?.price).toBe("13900");
  // Antes de la corrección este guardado la apagaba.
  expect(await rate("Mensajería")).toMatchObject({ is_active: true });
});

test("el checkout ofrece la tarifa del panel y el pedido conserva la elegida", async ({ page }) => {
  const estandar = (await rate("Estándar"))!;
  await page.goto(`${origin()}/productos/taza-de-barro`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/checkout`);
  await page.getByRole("textbox", { name: "Email" }).fill("comprador@example.test");
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Teléfono/).fill("2221234567");
  await page.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Puebla");
  await page.getByLabel("Código postal").fill("72000");
  await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("Puebla");

  // Las dos tarifas activas aparecen: la creada en el panel y la que ya existía.
  const shipping = page.getByRole("group", { name: "Forma de envío" });
  await expect(shipping.getByRole("radio")).toHaveCount(2);
  await shipping.getByRole("radio", { name: /Estándar/ }).check();
  await expect(shipping.getByRole("radio", { name: /Estándar/ })).toBeChecked();

  const confirm = page.getByRole("button", { name: /Confirmar pedido/ });
  await confirm.click();
  // Si el total cambió al elegir, la base pide confirmarlo con el total a la vista.
  const changed = page.getByRole("alert").filter({ hasText: "El total cambió" });
  if (await changed.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await page.getByRole("button", { name: "Aprobar pago" }).click();
  await expect(page.getByRole("heading", { name: "Gracias por tu compra" })).toBeVisible();

  const [order] = await admin<{ rate: string; total: string; name: string }[]>`
    select shipping_rate_id::text as rate, shipping_total::text as total,
           shipping_snapshot ->> 'name' as name
      from public.orders where store_id = ${tenant.storeId}
     order by created_at desc limit 1`;
  expect(order).toEqual({ rate: estandar.id, total: "9900", name: "Estándar" });
});
