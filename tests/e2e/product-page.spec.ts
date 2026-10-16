import { expect, test, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  uniq,
} from "./support";

/**
 * F9-T03 (F9-DESIGN §9, §16): ficha insignia. Insignias y ahorro verificables,
 * envío gratis y formas de pago de la configuración real, galería accesible,
 * «Más para tu objetivo» y compra completa en 3 clics o menos desde la ficha
 * (sin contar escribir los datos).
 */
const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(`ficha-${run}@example.test`);
  tenant = await createTenant(`fi${run}`, ownerId);
  // Abierta hace 60 días: lo que se publica ahora es una novedad (revisión M8).
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days' where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const attribute = await sql<{ id: string }[]>`
      select public.catalog_save_attribute(${tenant.storeId},
        ${sql.json({ name: "Objetivo", values: [{ label: "Energía" }] })}) as id`;
    const [energia] = await sql<{ id: string }[]>`
      select id from public.attribute_values where attribute_id = ${attribute[0]!.id} and key = 'energia'`;
    const product = async (title: string, variant: Record<string, unknown>, stock: number) => {
      const sku = `${title.slice(0, 4).toUpperCase()}-${run}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({ title, variants: [{ ...variant, sku }] })}) as r`;
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where store_id = ${tenant.storeId} and sku = ${sku.toUpperCase()}`;
      if (stock > 0)
        await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', ${stock}, 'Inicial')`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
      await sql`select public.catalog_set_product_attributes(${tenant.storeId}, ${p!.r.id}, ${[energia!.id]}::uuid[])`;
      return p!.r.id;
    };
    const cafeina = await product("Cafeína anhidra", { price: 20000, compare_at_price: 30000 }, 20);
    await product("Preentreno cítrico", { price: 45000 }, 20);
    await product("Guaraná", { price: 15000 }, 0); // agotado: nunca se recomienda
    await sql`select public.catalog_save_attribute(${tenant.storeId}, ${sql.json({ name: "Sabor", values: [{ label: "Limón" }] })})`;

    const zone = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: zone[0]!.id,
      name: "Estándar",
      type: "free_over",
      price: 9900,
      free_over_subtotal: 99900,
      est_days_min: 2,
      est_days_max: 5,
    })})`;
    // Dos imágenes (las filas bastan para probar la galería).
    await sql`reset role`;
    await sql`
      insert into public.media (store_id, owner_type, product_id, status, storage_path, mime_type, bytes,
                                width, height, alt_text, position)
      select ${tenant.storeId}, 'product', ${cafeina}, 'ready',
             ${tenant.storeId} || '/product/' || gen_random_uuid() || '/display.webp', 'image/webp', 100,
             800, 800, x.alt, x.pos
        from (values ('Frasco de frente', 0), ('Tabla nutrimental', 1)) x(alt, pos)`;
  });
  // La tienda declara sus formas de pago y su WhatsApp en Apariencia (publicado).
  await admin`
    update public.store_themes
       set settings = settings || ${admin.json({
         footer: { payment_methods: ["visa", "oxxo"] },
         contact: { whatsapp: "+525512345678" },
       })}
     where store_id = ${tenant.storeId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name)
              values (${tenant.storeId}, 'fake', 'active', 'Tarjeta (prueba)')`;
  await admin`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
              on conflict (key) do nothing`;
});

test("la ficha muestra datos verificables, galería accesible y relacionados", async ({ page }) => {
  await page.goto(`${origin()}/productos/cafeina-anhidra`);
  const badges = page.getByRole("list", { name: "Destacados", exact: true });
  await expect(badges.getByRole("listitem")).toHaveText(["Oferta"]);
  await expect(page.getByText("Ahorras $100.00 (33 %)")).toBeVisible();
  await expect(page.getByText("Envío gratis en compras desde $999.00.")).toBeVisible();
  // Costo y tiempo de la misma tarifa (revisión de conversión, M3).
  await expect(page.getByText("Si no, $99.00. Llega en 2–5 días.")).toBeVisible();
  await expect(page.getByText("Paga con Visa, OXXO.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Escríbenos por WhatsApp" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/525512345678\?text=/,
  );
  // Nada inventado: el espacio de opiniones solo se ve en la vista previa.
  await expect(page.getByText(/pendiente de contenido real/)).toHaveCount(0);

  // Galería: miniaturas como botones, flechas, sin avance automático.
  const main = page.getByRole("region", { name: "Imágenes" }).getByRole("img").first();
  await expect(main).toHaveAttribute("alt", "Frasco de frente");
  await page.getByRole("button", { name: "Ver imagen 2 de 2" }).click();
  await expect(main).toHaveAttribute("alt", "Tabla nutrimental");
  await expect(page.getByRole("button", { name: "Ver imagen 2 de 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Imagen siguiente" }).click();
  await expect(main).toHaveAttribute("alt", "Frasco de frente");

  const related = page.getByRole("region", { name: "Más para tu objetivo" });
  await expect(related.getByRole("heading", { name: "Preentreno cítrico" })).toBeVisible();
  await expect(related.getByRole("heading", { name: "Guaraná" })).toHaveCount(0);
  await expect(related.getByRole("heading", { name: "Cafeína anhidra" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  // JSON-LD sin calificaciones ni reseñas (D-F9-04).
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.join("")).not.toMatch(/aggregateRating|review/i);
});

/** Cuenta los clics del comprador (los que hace la prueba con `click`). */
function countingClicks(page: Page) {
  let clicks = 0;
  return {
    click: async (name: string | RegExp) => {
      clicks += 1;
      await page.getByRole("button", { name }).click();
    },
    get count() {
      return clicks;
    },
  };
}

test("compra completa en 3 clics desde la ficha", async ({ page }) => {
  const buyer = countingClicks(page);
  await page.goto(`${origin()}/productos/cafeina-anhidra`);
  await buyer.click("Comprar ahora");
  await expect(page).toHaveURL(`${origin()}/checkout`);

  // Escribir los datos no cuenta como clic; al salir del último campo de la
  // dirección se cotiza el envío solo y se preselecciona la tarifa.
  await page.getByRole("textbox", { name: "Email" }).fill(`comprador-${run}@example.test`);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Teléfono/).fill("2221234567");
  await page.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Puebla");
  await page.getByLabel("Estado", { exact: true }).fill("Puebla");
  await page.getByLabel("Código postal").fill("72000");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: /Estándar/ })).toBeChecked();
  const resumen = page.getByRole("complementary", { name: "Resumen del pedido" });
  await expect(resumen).toContainText("$299.00"); // 200 + 99 de envío
  // Lo escrito sigue ahí tras cotizar (sin reinicio del formulario).
  await expect(page.getByLabel("Nombre completo")).toHaveValue("Ana Ruiz");
  await expectNoSeriousA11yViolations(page);

  await buyer.click("Confirmar pedido");
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await buyer.click("Aprobar pago");
  await expect(page.getByRole("heading", { name: "Gracias por tu compra" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Pagado — por preparar");
  expect(buyer.count).toBeLessThanOrEqual(3);

  const [order] = await admin<{ total: string; payment_status: string }[]>`
    select total, payment_status from public.orders where store_id = ${tenant.storeId}`;
  expect(order).toEqual({ total: "29900", payment_status: "paid" });
});

test("móvil: barra fija «Comprar ahora» y cantidad con −/+ (revisión de conversión, A3 y B3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${origin()}/productos/cafeina-anhidra`);
  const bar = page.getByRole("region", { name: "Compra rápida" });

  // Con los botones principales a la vista, la barra no se muestra.
  const plus = page.getByRole("button", { name: "Sumar 1" });
  await page.getByRole("button", { name: "Agregar al carrito" }).scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
  const quantity = page.getByLabel("Cantidad", { exact: true });
  await expect(page.getByRole("button", { name: "Restar 1" })).toBeDisabled();
  await plus.click();
  await plus.click();
  await page.getByRole("button", { name: "Restar 1" }).click();
  await expect(quantity).toHaveValue("2");

  // Al bajar aparece con el precio, y no tapa el pie de la tienda.
  await page.mouse.wheel(0, 5000);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("$200.00");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const barTop = (await bar.boundingBox())!.y;
  const copyright = page.getByRole("contentinfo").getByText(/^©/);
  expect(
    (await copyright.boundingBox())!.y + (await copyright.boundingBox())!.height,
  ).toBeLessThanOrEqual(barTop);
  await expectNoSeriousA11yViolations(page);

  // Compra directa con la cantidad elegida.
  await bar.getByRole("button", { name: "Comprar ahora" }).click();
  await expect(page).toHaveURL(`${origin()}/checkout`);
  await expect(page.getByRole("complementary", { name: "Resumen del pedido" })).toContainText(
    "$400.00",
  );
});
