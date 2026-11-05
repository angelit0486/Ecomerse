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
 * Personalidad del diseño (tema v5, ADR-063 fase B-1): con el interruptor
 * apagado la pestaña no existe y la tienda se ve como siempre; encendido, la
 * dueña elige tarjetas y títulos, publica y sus clientes ven la tienda con su
 * propio carácter, sin violaciones de accesibilidad.
 */
const run = uniq();
const ownerEmail = `personalidad-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

const store = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`pz${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    for (const title of ["Collar de plata", "Anillo de oro", "Aretes de perla", "Pulsera fina"]) {
      const sku = `${title.slice(0, 3).toUpperCase()}-${run}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId},
          ${sql.json({ title, variants: [{ price: 89900, sku }] })}) as r`;
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where store_id = ${tenant.storeId} and sku = ${sku.toUpperCase()}`;
      await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    }
  });
});

test("apagado sin pestaña; encendido, la dueña elige, publica y la tienda cambia", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/apariencia`);
  await expect(page.getByRole("heading", { name: "Apariencia", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Personalidad", exact: true })).toHaveCount(0);
  // Aunque se pida por la dirección, sin interruptor se queda en Marca.
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=personalidad`);
  await expect(page.getByLabel("Estilo de las tarjetas de producto")).toHaveCount(0);

  const shopper = await page.context().newPage();
  await shopper.goto(`${store()}/productos`);
  await expect(shopper.getByRole("link", { name: "Collar de plata" })).toBeVisible();
  const root = shopper.locator(".sf-root");
  for (const attr of ["data-card", "data-ratio", "data-hcase", "data-motion"]) {
    await expect(root).not.toHaveAttribute(attr, /.*/);
  }
  // La foto de la tarjeta sigue cuadrada.
  const ratio = await shopper
    .locator(".sf-card-media")
    .first()
    .evaluate((el) => getComputedStyle(el).aspectRatio);
  expect(ratio).toBe("1 / 1");
  await shopper.close();

  // Encendido: la dueña elige la personalidad, publica y la tienda cambia.
  await admin`insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
              values ('theme_personality', 'store', ${tenant.storeId}, true, 'E2E personalidad')`;
  await page.goto(`/admin/${tenant.handle}/apariencia`);
  await page.getByRole("link", { name: "Personalidad", exact: true }).click();
  await expect(page.getByLabel("Estilo de las tarjetas de producto")).toHaveValue("outlined");
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel("Estilo de las tarjetas de producto").selectOption("flat");
  await page.getByLabel("Forma de la foto").selectOption("4:5");
  await page.getByLabel("Texto de la tarjeta").selectOption("center");
  await page.getByLabel("Mayúsculas en los títulos").selectOption("uppercase");
  await page.getByLabel("Espacio entre letras de los títulos").selectOption("wide");
  await page.getByLabel("Grosor de los títulos").selectOption("regular");
  await page.getByLabel("Movimiento").selectOption("subtle");
  // La vista rápida sigue lo elegido.
  await expect(page.getByText("Lo más nuevo")).toHaveClass(/uppercase/);
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Guardado en el borrador" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Forma de la foto")).toHaveValue("4:5");

  await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByRole("button", { name: "Sí, publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();
  const [saved] = await admin<{ p: unknown }[]>`
    select settings -> 'personality' as p from public.store_themes where store_id = ${tenant.storeId}`;
  expect(saved?.p).toEqual({
    card_style: "flat",
    image_ratio: "4:5",
    card_align: "center",
    heading_case: "uppercase",
    heading_tracking: "wide",
    heading_weight: "regular",
    motion: "subtle",
  });

  const buyer = await page.context().newPage();
  await buyer.goto(`${store()}/productos`);
  const after = buyer.locator(".sf-root");
  await expect(after).toHaveAttribute("data-card", "flat");
  await expect(after).toHaveAttribute("data-ratio", "4:5");
  await expect(after).toHaveAttribute("data-hcase", "upper");
  const card = buyer.locator(".sf-card").first();
  const look = await card.evaluate((el) => {
    const media = el.querySelector(".sf-card-media")!;
    return {
      border: getComputedStyle(el).borderTopColor,
      padding: getComputedStyle(el).paddingTop,
      align: getComputedStyle(el).textAlign,
      ratio: getComputedStyle(media).aspectRatio,
    };
  });
  expect(look).toEqual({
    border: "rgba(0, 0, 0, 0)",
    padding: "0px",
    align: "center",
    ratio: "4 / 5",
  });
  const heading = await buyer.getByRole("heading", { level: 1 }).evaluate((el) => ({
    transform: getComputedStyle(el).textTransform,
    weight: getComputedStyle(el).fontWeight,
  }));
  expect(heading).toEqual({ transform: "uppercase", weight: "400" });
  await expectNoSeriousA11yViolations(buyer);
  await buyer.close();
});
