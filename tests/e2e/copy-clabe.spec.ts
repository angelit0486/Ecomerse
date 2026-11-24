import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  uniq,
} from "./support";

/**
 * «Copiar CLABE» en la página del pedido: con pago por transferencia, la CLABE
 * de las instrucciones (con dígito de control válido) y el número de pedido se
 * copian de un toque para pegarlos en la app del banco.
 */
const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.beforeAll(async () => {
  const ownerId = await createAuthUser(`clabe-${run}@example.test`);
  tenant = await createTenant(`cb${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0, country = 'MX'
               where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Libreta cosida",
        variants: [{ price: 18000, sku: `CLABE-${run}`, weight_g: 300 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`CLABE-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 10, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    const [z] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: z!.id,
      name: "Estándar",
      type: "flat",
      price: 10000,
    })})`;
  });
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${tenant.storeId}, 'manual', 'active', 'Transferencia',
                      ${admin.json({ instructions: "Transferencia SPEI\nCLABE: 1670 4100 0088 4002 81\nTel. 55 1234 5678" })})`;
});

test("la CLABE y el número de pedido se copian de un toque", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: origin() });
  await page.goto(`${origin()}/productos/libreta-cosida`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/checkout`);
  await page.getByRole("textbox", { name: "Email" }).fill(`cliente-${run}@example.test`);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Celular/).fill("662 555 0101");
  await page.getByLabel("Calle, número e interior").fill("Av. Reforma 123");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Hermosillo");
  await page.getByLabel("Código postal").fill("83000");
  await page.getByLabel("Estado", { exact: true }).selectOption("Sonora");
  await page.getByRole("radio", { name: /Estándar/ }).check();
  await page.getByRole("radio", { name: /Transferencia/ }).check();
  await page.getByRole("button", { name: /^Confirmar pedido/ }).click();
  await expect(page).toHaveURL(/\/pedido\/[0-9a-f-]+\?t=/);

  const [order] = await admin<{ display_number: string }[]>`
    select display_number::text from public.orders where store_id = ${tenant.storeId}`;

  // Se ve agrupada para leerla; el teléfono del texto no se ofrece como CLABE.
  const box = page.locator("[data-pay-copy]");
  await expect(box.getByText("1670 4100 0088 4002 81", { exact: true })).toBeVisible();
  await expect(box.getByRole("button")).toHaveCount(2);

  await box.getByRole("button", { name: "Copiar CLABE" }).click();
  await expect(box.getByRole("button", { name: "Copiar CLABE" })).toHaveText("Copiada ✓");
  await expect(page.getByRole("status").filter({ hasText: "CLABE: copiada" })).toBeAttached();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("167041000088400281");

  await box.getByRole("button", { name: "Copiar Número de pedido" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    order!.display_number.replace(/^#/, ""),
  );
  await expect(box.getByRole("button", { name: "Copiar Número de pedido" })).toHaveText(
    "Copiado ✓",
  );

  await expectNoSeriousA11yViolations(page);
});
