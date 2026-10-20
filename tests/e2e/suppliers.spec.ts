import { createHash, randomBytes } from "node:crypto";

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
 * ADR-025 · Proveedores: la dueña da de alta un proveedor, vincula una variante
 * por SKU con la disponibilidad que le informaron y la tienda la vende; al
 * informar «No disponible», la tienda la muestra agotada.
 */
const run = uniq();
const ownerEmail = `prov-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const SKU = `PROV-${run}`.toUpperCase();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`pv${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days' where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Creatina de proveedor",
        slug: "creatina-proveedor",
        variants: [{ price: 49900, sku: SKU }],
      })}) as r`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
  });
});

test("alta de proveedor, disponibilidad vendible y agotado al quedarse sin piezas", async ({
  page,
}) => {
  const product = `http://${tenant.handle}.localhost:3000/productos/creatina-proveedor`;
  await page.goto(product);
  await expect(page.getByText("Agotado").first()).toBeVisible();

  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos`);
  await page.getByText("Más del catálogo").click();
  await page.getByRole("link", { name: "Proveedores" }).click();
  await page.getByLabel("Nombre del proveedor").fill("Distribuidora Norte");
  await page.getByLabel("Plazo de despacho mínimo (días)").fill("2");
  await page.getByLabel("Plazo de despacho máximo (días)").fill("4");
  await page.getByRole("button", { name: "Agregar proveedor" }).click();
  await expect(page.getByText("Proveedor «Distribuidora Norte» creado.")).toBeVisible();
  await page.getByRole("link", { name: "Distribuidora Norte" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Distribuidora Norte" })).toBeVisible();

  const link = page.getByRole("region", { name: "Variantes que surte" });
  await link.getByLabel("SKU de tu tienda").fill(SKU.toLowerCase());
  await link.getByLabel("SKU del proveedor").fill("DN-778");
  await link.getByLabel("Costo de adquisición").fill("250.00");
  await link.getByLabel("Piezas informadas").first().fill("6");
  await link.getByRole("button", { name: "Vincular variante" }).click();
  await expect(link.getByText("Guardado. Disponibles del proveedor: 6.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Disponible · 6 informadas · en venta 6, reservadas 0/),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // La tienda lo vende (la caché se invalidó al guardar).
  await page.goto(product);
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeEnabled();

  // El proveedor ya no tiene piezas: agotado en la tienda.
  await page.goto(`/admin/${tenant.handle}/productos/proveedores`);
  await page.getByRole("link", { name: "Distribuidora Norte" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Creatina de proveedor" });
  await row.getByLabel("Disponibilidad informada").selectOption("unavailable");
  await row.getByRole("button", { name: "Actualizar disponibilidad" }).click();
  await expect(row.getByText("Guardado. Disponibles del proveedor: 0.")).toBeVisible();
  await page.goto(product);
  await expect(page.getByText("Agotado").first()).toBeVisible();
});

test("lista del proveedor por CSV, plazo en la ficha y despacho al pagarse el pedido", async ({
  page,
}) => {
  // Tienda y dueña propias (la 2FA se activa una sola vez por usuario).
  const r2 = uniq();
  const email = `prov2-${r2}@example.test`;
  const ownerId = await createAuthUser(email);
  const t = await createTenant(`pw${r2}`, ownerId);
  const sku = `CSV-${r2}`.toUpperCase();
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days', tax_rate_bps = 0
               where id = ${t.storeId}`;
  let variantId = "";
  let supplierId = "";
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${t.storeId}, ${sql.json({
        title: "Proteína de proveedor",
        slug: "proteina-proveedor",
        variants: [{ price: 50000, sku }],
      })}) as r`;
    await sql`select public.catalog_publish_product(${t.storeId}, ${p!.r.id})`;
    const [s] = await sql<{ id: string }[]>`
      select public.suppliers_save(${t.storeId}, ${sql.json({
        name: "Mayorista Sur",
        lead_time_min_days: 2,
        lead_time_max_days: 4,
      })}) as id`;
    supplierId = s!.id;
  });
  const [v] = await admin<{ id: string }[]>`
    update public.product_variants set requires_shipping = false where store_id = ${t.storeId} and sku = ${sku}
    returning id`;
  variantId = v!.id;
  const [acct] = await admin<{ id: string }[]>`
    insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
    values (${t.storeId}, 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123456789"}')
    returning id`;

  await loginNewStaff(page, email);
  await page.goto(`/admin/${t.handle}/productos/proveedores/${supplierId}`);
  await page.getByText("Cargar la lista del proveedor (CSV)").click();
  const upload = async (csv: string) => {
    await page.getByLabel("Archivo CSV").setInputFiles({
      name: "lista.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Cargar disponibilidad" }).click();
  };
  // Con un SKU que no existe no se aplica nada y se dice en qué fila.
  await upload(`sku,disponibilidad,cantidad\n${sku},disponible,3\nNO-EXISTE,disponible,1\n`);
  await expect(
    page.getByText("Fila 3: No hay una variante con ese SKU en tu tienda."),
  ).toBeVisible();
  await upload(
    `sku,disponibilidad,cantidad,sku_proveedor\n${sku.toLowerCase()},disponible,3,MS-55\n`,
  );
  await expect(page.getByText("1 variante actualizada.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Disponible · 3 informadas · en venta 3, reservadas 0/),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Solo hay piezas del proveedor: la ficha dice su plazo, nunca su nombre.
  const product = `http://${t.handle}.localhost:3000/productos/proteina-proveedor`;
  await page.goto(product);
  await expect(page.getByText("Se prepara en 2 a 4 días antes de enviarse")).toBeVisible();
  await expect(page.getByText("Mayorista Sur")).toHaveCount(0);

  // Pedido pagado: nace el despacho con lo que hay que pedirle al proveedor.
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${t.storeId}, ${token}, ${variantId}, 2)`;
  const idem = `idem-${r2}-${"y".repeat(16)}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${t.storeId}, ${token}, ${admin.json({
      email: `c-${r2}@example.test`,
      customer_name: "Cliente",
      payment_account_id: acct!.id,
    })}, ${100000}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', 'manual')`;

  await page.goto(`/admin/${t.handle}/pedidos`);
  await page.getByRole("link", { name: "Despachos de proveedores por atender (1)" }).click();
  const card = page.getByRole("article", { name: "Despacho de Mayorista Sur" });
  await expect(card.getByText("Por pedir al proveedor")).toBeVisible();
  await expect(card.getByText(/2 ×\s*Proteína de proveedor/)).toBeVisible();
  await expect(card.getByText(/SKU proveedor MS-55/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await card.getByLabel("Referencia del proveedor (opcional)").fill("PO-77");
  await card.getByRole("button", { name: "Ya lo pedí al proveedor" }).click();
  await expect(card.getByText("Despacho: solicitado al proveedor.")).toBeVisible();

  await page.goto(`/admin/${t.handle}/pedidos/${o!.r.order_id}`);
  const section = page.getByRole("region", { name: "Despachos de proveedores" });
  await expect(section.getByText("Solicitado al proveedor")).toBeVisible();
  await expect(section.getByText(/Referencia: PO-77/)).toBeVisible();
});
