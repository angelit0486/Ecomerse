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
 * F9-T04 (F9-DESIGN §10): insignias en las tarjetas, filtro de marca, buscador
 * con sugerencias (combobox con teclado), menú de 2 niveles con «Objetivos»
 * armado desde el panel y barra de envío gratis en el carrito.
 */
const run = uniq();
const ownerEmail = `nav-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`nv${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin`insert into public.brands (store_id, name, slug) values
                (${tenant.storeId}, 'Atlas Nutrición', 'atlas'), (${tenant.storeId}, 'Bruma Labs', 'bruma')`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const attribute = await sql<{ id: string }[]>`
      select public.catalog_save_attribute(${tenant.storeId},
        ${sql.json({ name: "Objetivo", values: [{ label: "Energía" }, { label: "Recuperación" }] })}) as id`;
    const value = async (key: string) =>
      (
        await sql<{ id: string }[]>`
          select id from public.attribute_values where attribute_id = ${attribute[0]!.id} and key = ${key}`
      )[0]!.id;
    const product = async (
      title: string,
      brand: string,
      variant: Record<string, unknown>,
      stock: number,
      goal: string,
      threshold?: number,
    ) => {
      const sku = `${title.slice(0, 4).toUpperCase()}-${run}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
          title,
          brand_id: (
            await sql<
              { id: string }[]
            >`select id from public.brands where store_id = ${tenant.storeId} and slug = ${brand}`
          )[0]!.id,
          variants: [{ ...variant, sku }],
        })}) as r`;
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where store_id = ${tenant.storeId} and sku = ${sku.toUpperCase()}`;
      await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', ${stock}, 'Inicial')`;
      if (threshold !== undefined)
        await sql`select public.inventory_set_threshold(${tenant.storeId}, ${v!.id}, ${threshold})`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
      await sql`select public.catalog_set_product_attributes(${tenant.storeId}, ${p!.r.id}, ${[await value(goal)]}::uuid[])`;
    };
    await product(
      "Cafeína anhidra",
      "atlas",
      { price: 20000, compare_at_price: 25000 },
      20,
      "energia",
    );
    await product("Creatina pura", "bruma", { price: 50000 }, 2, "recuperacion", 5);
    await product("Electrolitos", "bruma", { price: 15000 }, 20, "energia");
    const zone = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: zone[0]!.id,
      name: "Estándar",
      type: "free_over",
      price: 9900,
      free_over_subtotal: 60000,
    })})`;
  });
});

test("listado: insignias en las tarjetas y filtro de marca", async ({ page }) => {
  await page.goto(`${origin()}/productos`);
  const card = (title: string) =>
    page.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) });
  await expect(card("Cafeína anhidra").getByRole("listitem")).toHaveText(["Oferta", "Nuevo"]);
  await expect(card("Creatina pura").getByRole("listitem")).toHaveText(["Nuevo", "Últimas piezas"]);
  // Nunca la cantidad exacta.
  await expect(card("Creatina pura")).not.toContainText(/\b2 piezas\b/);

  const filters = page.getByRole("form", { name: "Filtros" });
  const brand = filters.getByRole("group", { name: "Marca" });
  await expect(brand.getByLabel(/Bruma Labs/)).toBeVisible();
  await brand.getByLabel(/Bruma Labs/).check();
  await filters.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(`${origin()}/productos?marca=bruma`);
  await expect(page.getByRole("heading", { name: "Creatina pura" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Electrolitos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cafeína anhidra" })).toHaveCount(0);

  // Marca + objetivo (AND), y quitar la marca desde los filtros activos.
  await filters
    .getByRole("group", { name: "Objetivo" })
    .getByLabel(/Energía/)
    .check();
  await filters.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("heading", { name: "Electrolitos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Creatina pura" })).toHaveCount(0);
  await page.getByRole("link", { name: "Quitar el filtro Marca: Bruma Labs" }).click();
  await expect(page.getByRole("heading", { name: "Cafeína anhidra" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("buscador con sugerencias: escribir, moverse con flechas y elegir", async ({ page }) => {
  await page.goto(origin());
  const box = page.getByRole("combobox", { name: "Buscar productos" });
  await box.fill("crea");
  const list = page.getByRole("listbox", { name: "Sugerencias" });
  await expect(list.getByRole("option", { name: /Creatina pura/ })).toBeVisible();
  await expect(list.getByRole("option", { name: "Buscar «crea»" })).toBeVisible();
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await expectNoSeriousA11yViolations(page);

  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await box.fill("energ");
  await expect(list.getByRole("option", { name: /Energía/ })).toBeVisible();
  // Primero van los productos (los de objetivo Energía también coinciden); las
  // flechas llegan a la opción del objetivo.
  const selected = list.getByRole("option", { selected: true });
  for (let i = 0; i < 8; i += 1) {
    await box.press("ArrowDown");
    if ((await selected.textContent())?.startsWith("Energía")) break;
  }
  await expect(selected).toHaveText(/^EnergíaObjetivo$/);
  await box.press("Enter");
  await expect(page).toHaveURL(`${origin()}/productos?objetivo=energia`);

  // Enter sin elegir: búsqueda completa (también sin JavaScript).
  await box.fill("electro");
  await expect(list.getByRole("option", { name: "Buscar «electro»" })).toBeVisible();
  await expect(list.getByRole("option", { selected: true })).toHaveCount(0);
  await box.press("Enter");
  await expect(page).toHaveURL(`${origin()}/buscar?q=electro`);
});

test("menú «Objetivos» de 2 niveles armado desde el panel", async ({ page, browser }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/contenido/menus`);
  const main = page.getByRole("form", { name: "Menú principal" });
  await main.getByRole("button", { name: "Agregar enlace" }).click();
  await main.getByLabel("Texto de enlace 1").fill("Objetivos");
  await main.getByLabel("Destino de enlace 1").selectOption("search");
  await main.getByRole("button", { name: "Agregar subenlace a enlace 1" }).click();
  await main.getByLabel("Texto de enlace 1.1").fill("Energía");
  await main.getByLabel("Destino de enlace 1.1").selectOption("filter");
  await main
    .getByLabel("Objetivo o filtro de enlace 1.1")
    .selectOption({ label: "Objetivo: Energía" });
  await main.getByRole("button", { name: "Guardar menú principal" }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "Menú principal guardado." }),
  ).toBeVisible();
  await page.reload();
  await expect(main.getByLabel("Destino de enlace 1.1")).toHaveValue("filter");
  await expectNoSeriousA11yViolations(page);

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(origin());
  const nav = shopper.getByRole("navigation", { name: "Principal" });
  const toggle = nav.getByRole("button", { name: "Más de Objetivos" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Energía" })).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Energía" })).toBeVisible();
  await expectNoSeriousA11yViolations(shopper);
  await shopper.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.press("Enter");
  await nav.getByRole("link", { name: "Energía" }).click();
  await expect(shopper).toHaveURL(`${origin()}/productos?objetivo=energia`);

  // Móvil: un botón «Menú» muestra la lista con los subniveles abiertos.
  await shopper.setViewportSize({ width: 375, height: 800 });
  await shopper.goto(origin());
  const menuButton = nav.getByRole("button", { name: "Menú" });
  await expect(nav.getByRole("link", { name: "Objetivos" })).toBeHidden();
  await menuButton.click();
  await expect(nav.getByRole("link", { name: "Energía" })).toBeVisible();
  await expectNoSeriousA11yViolations(shopper);
});

test("carrito: barra «te faltan $X para el envío gratis» con la regla real", async ({ page }) => {
  await page.goto(`${origin()}/productos/cafeina-anhidra`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/carrito`);
  await expect(page.getByText("Te faltan $400.00 para el envío gratis.")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "33");
  await expectNoSeriousA11yViolations(page);

  await page
    .getByLabel(/Cantidad/)
    .first()
    .fill("3");
  await page
    .getByRole("button", { name: /Actualizar/ })
    .first()
    .click();
  await expect(page.getByText("Tu pedido tiene envío gratis.")).toBeVisible();
});
