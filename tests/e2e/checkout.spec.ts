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
 * F6-T05: del carrito al pedido pagado con el proveedor `fake`. El total que
 * manda el navegador no manda: si se manipula, la base responde price_changed.
 * Después, el pedido aparece en el panel; el staff configura envíos, impuestos
 * y descuentos desde el panel.
 */
// El segundo test usa el pedido del primero.
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `checkout-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

async function asOwner<T>(ownerId: string, work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`k${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), prices_include_tax = true,
              tax_rate_bps = 1600 where id = ${tenant.storeId}`;
  await asOwner(ownerId, async (sql) => {
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Taza de barro",
        variants: [{ price: 25000, sku: `TAZA-${run}`, weight_g: 400 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`TAZA-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    const zone = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: zone[0]!.id,
      name: "Estándar",
      type: "flat",
      price: 9900,
      est_days_min: 2,
      est_days_max: 5,
    })})`;
    await sql`select public.discounts_upsert(${tenant.storeId}, ${sql.json({
      code: "BIENVENIDA",
      type: "percentage",
      value: 1000,
    })})`;
  });
  // Cuentas de pago: su configuración en el panel llega en la F7 (D-F6-06).
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name)
              values (${tenant.storeId}, 'fake', 'active', 'Tarjeta (prueba)')`;
  await admin`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
              on conflict (key) do nothing`;
});

test("del carrito al pedido pagado; el total manipulado se rechaza", async ({ page }) => {
  await page.goto(`${origin()}/productos/taza-de-barro`);
  await page.getByLabel("Cantidad").fill("2");
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Carrito/ })).toContainText("2");

  await page.getByRole("link", { name: "Ver carrito (2)" }).click();
  await expect(page.getByRole("heading", { name: "Tu carrito" })).toBeVisible();
  // El código va plegado tras «¿Tienes un código?» (revisión de conversión, M10).
  await expect(page.getByLabel("Código de descuento")).toBeHidden();
  await page.getByText("¿Tienes un código de descuento?").click();
  await page.getByLabel("Código de descuento").fill("noexiste");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ese código no existe." })).toBeVisible();
  await page.getByLabel("Código de descuento").fill("bienvenida");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Código aplicado." })).toBeVisible();
  const summary = page.getByRole("complementary", { name: "Resumen" });
  await expect(summary).toContainText("$500.00");
  await expect(summary).toContainText("−$50.00");
  // Sin dirección el total lo dice: aún no lleva el envío (auditoría UX-05).
  await expect(summary).toContainText("Total sin envío");
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: "Continuar al pago" }).click();
  await expect(page.getByRole("heading", { name: "Finalizar compra", exact: true })).toBeVisible();
  // White-label: la pestaña lleva el nombre de la tienda, nunca el de la plataforma.
  await expect(page).toHaveTitle(`Finalizar compra · Tienda ${`k${run}`.toUpperCase()}`);
  // Confirmar con todo vacío: todos los faltantes a la vez y el foco en el primero (Gate F9).
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Faltan \d+ datos/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
  await expect(page.getByText("Escribe la colonia.")).toBeVisible();
  await expect(page.getByText("Escribe un teléfono para la paquetería.")).toBeVisible();
  // Pago sin distracciones: encabezado mínimo, sin buscador (auditoría UX-12).
  await expect(page.getByText("Pago seguro")).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al carrito" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Buscar productos" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Email" }).fill("Comprador@Example.test");
  // El error del campo corregido se quita al momento y el conteo baja (UX-03).
  await expect(page.getByText("Escribe un email válido.")).toHaveCount(0);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Teléfono/).fill("2221234567");
  await page.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Puebla");
  // Con el CP completo el estado se propone solo.
  await page.getByLabel("Código postal").fill("72000");
  await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("Puebla");
  // Clic directo en «Confirmar» sin salir del campo: el servidor elige el envío
  // y pide confirmar con el total a la vista (no se pierde el clic, Gate F9).
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Elegimos «Estándar»" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Estándar/ })).toBeChecked();
  const resumen = page.getByRole("complementary", { name: "Resumen del pedido" });
  await expect(resumen).toContainText("$549.00");
  await expectNoSeriousA11yViolations(page);

  // El navegador manipula el total: la base no lo acepta.
  await page
    .locator('input[name="expected_total"]')
    .evaluate((el: HTMLInputElement) => (el.value = "100"));
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "El total cambió a $549.00" }),
  ).toBeVisible();
  const [orders] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.orders where store_id = ${tenant.storeId}`;
  expect(orders!.n).toBe(0);

  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Aprobar pago" }).click();
  await expect(page.getByRole("heading", { name: "Gracias por tu compra" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Pagado — por preparar");
  await expect(page.getByText("$549.00").first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  const orderUrl = page.url();

  // El enlace sin token no muestra nada.
  const bare = await page.goto(orderUrl.split("?")[0]!);
  expect(bare?.status()).toBe(404);

  // El carrito convertido ya no existe: el contador vuelve a 0.
  await page.goto(`${origin()}/`);
  await expect(page.getByRole("link", { name: /^Carrito/ })).toContainText("0");

  const [order] = await admin<
    { status: string; payment_status: string; total: string; email: string }[]
  >`
    select status, payment_status, total, email from public.orders where store_id = ${tenant.storeId}`;
  expect(order).toEqual({
    status: "open",
    payment_status: "paid",
    total: "54900",
    email: "comprador@example.test",
  });
});

test("panel: el pedido pagado, envíos, impuestos y descuentos", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "#1001" }).click();
  await expect(page.getByRole("heading", { name: "Pedido #1001" })).toBeVisible();
  await expect(page.getByText("Pagado — por preparar")).toBeVisible();
  await expect(page.getByText("comprador@example.test")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: "Impuestos" }).click();
  await page.getByRole("textbox", { name: /^Tasa de impuesto/ }).fill("8");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Impuestos guardados." })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: "Envíos" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la zona México" })).toHaveValue(
    "México",
  );
  await page.getByRole("textbox", { name: "Nombre de la zona", exact: true }).fill("Frontera");
  await page
    .getByRole("textbox", { name: /^Países/ })
    .first()
    .fill("MX");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la zona Frontera" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: "Descuentos" }).click();
  await expect(page.getByText("BIENVENIDA").first()).toBeVisible();
  await expect(page.getByText(/usado 1/)).toBeVisible();
  await page.getByRole("button", { name: "Desactivar BIENVENIDA" }).click();
  await expect(page.getByRole("button", { name: "Activar BIENVENIDA" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});
