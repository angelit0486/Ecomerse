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
 * ADR-030: precios de oferta con fechas. Programar desde la ficha (empieza ya),
 * verla en la tienda con su vigencia, cancelarla (el precio regresa) y
 * programar en bloque desde el listado.
 */
const run = uniq();
const ownerEmail = `ofertas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let productId = "";
let timeZone = "America/Mexico_City";
const origin = () => `http://${tenant.handle}.localhost:3000`;
const sku = `OF-${run}`.toUpperCase();

/** «YYYY-MM-DDTHH:MM» en la hora de la tienda, desplazado desde ahora. */
function local(offsetMs: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(Date.now() + offsetMs))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const DAY = 24 * 60 * 60 * 1000;

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`of${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days' where id = ${tenant.storeId}`;
  const [store] = await admin<{ timezone: string }[]>`
    select timezone from public.stores where id = ${tenant.storeId}`;
  timeZone = store!.timezone;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Creatina Oferta",
        slug: "creatina-oferta",
        variants: [{ price: 69900, sku, inventory_policy: "continue" }],
      })}) as r`;
    productId = p!.r.id;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${productId})`;
  });
});

async function priceInDb() {
  const [v] = await admin<{ price: string; compare_at_price: string | null }[]>`
    select price, compare_at_price from public.product_variants where sku = ${sku}`;
  return `${v!.price}/${v!.compare_at_price ?? "-"}`;
}

test("oferta en la ficha (empieza ya), en la tienda, cancelada y en bloque a futuro", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/${productId}`);
  const sales = page.getByRole("region", { name: "Ofertas con fechas" });
  await sales.getByLabel("Descuento (%)").fill("10");
  await sales.getByLabel("Termina").fill(local(3 * DAY));
  await sales.getByRole("button", { name: "Ver vista previa" }).click();
  const preview = sales.getByRole("region", { name: "Vista previa de la oferta" });
  await expect(preview.getByText("$629.00")).toBeVisible();
  expect(await priceInDb()).toBe("69900/-");
  await preview.getByRole("button", { name: "Programar oferta" }).click();
  await expect(sales.getByText(/Oferta aplicada en 1 presentación/)).toBeVisible();
  expect(await priceInDb()).toBe("62900/69900");
  await expect(sales.getByRole("cell", { name: "Activa" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // La tienda: precio de oferta, el anterior tachado y la vigencia.
  await page.goto(`${origin()}/productos/creatina-oferta`);
  await expect(page.getByText(/Oferta válida hasta el/)).toBeVisible();
  await expect(page.getByText("$629.00").first()).toBeVisible();

  await page.goto(`/admin/${tenant.handle}/productos/${productId}`);
  await sales.getByRole("button", { name: /Cancelar/ }).click();
  await sales.getByRole("button", { name: "Sí, cancelar la oferta" }).click();
  await expect(sales.getByText("Oferta cancelada.")).toBeVisible();
  expect(await priceInDb()).toBe("69900/-");
  await expect(sales.getByRole("cell", { name: "Cancelada" })).toBeVisible();

  // El historial cuenta lo que pasó.
  const history = page.getByRole("region", { name: "Historial" });
  await expect(history.getByText("Programó una oferta")).toBeVisible();
  await expect(history.getByText("Canceló una oferta")).toBeVisible();

  // En bloque desde el listado, a futuro: el precio no cambia todavía.
  await page.goto(`/admin/${tenant.handle}/productos`);
  await page.getByRole("checkbox", { name: /Creatina Oferta/ }).check();
  await page.getByLabel("Acción masiva").selectOption("sale");
  await page.getByRole("link", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Programar oferta" })).toBeVisible();
  await page.getByLabel("Precio fijo").check();
  await page.getByLabel("Precio de oferta").fill("500");
  await page.getByLabel("Empieza (vacío = ahora)").fill(local(DAY));
  await page.getByLabel("Termina").fill(local(2 * DAY));
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await expect(
    page.getByRole("region", { name: "Vista previa de la oferta" }).getByText("$500.00"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Programar oferta" }).click();
  await expect(page.getByText(/Oferta programada en 1 presentación/)).toBeVisible();
  expect(await priceInDb()).toBe("69900/-");

  await page.goto(`/admin/${tenant.handle}/productos/ofertas`);
  await expect(page.getByRole("cell", { name: "Programada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Creatina Oferta" }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});
