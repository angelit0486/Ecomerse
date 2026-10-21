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
 * Pulido: varias tiendas en el mismo panel. La plataforma agrega una segunda
 * tienda a la organización (`platform_add_store`); la dueña la ve en «Tus
 * tiendas» y en el selector, cambia entre ellas y cada una tiene su catálogo.
 */
const run = uniq();
const ownerEmail = `varias-${run}@example.test`;
const adminEmail = `padmin-varias-${run}@platform.test`;
const handle = `mujer${run}`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`vs${run}`, ownerId);
  await admin`insert into public.platform_staff (user_id, role)
              values (${await createAuthUser(adminEmail)}, 'platform_admin')`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.catalog_upsert_category(${tenant.storeId}, ${sql.json({
      name: "Proteínas veganas",
      description: "Proteína de chícharo y arroz.",
    })})`;
    await sql`select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
      title: "Proteína de la primera tienda",
      variants: [{ price: 59900, sku: `PRI-${run}` }],
    })})`;
  });
});

test("la plataforma agrega una tienda y la dueña administra las dos desde el mismo panel", async ({
  page,
  browser,
}) => {
  // 1. La plataforma agrega la tienda a la organización.
  const platform = await (await browser.newContext()).newPage();
  await loginNewStaff(platform, adminEmail);
  await platform.goto(`/platform?q=org-vs${run}`);
  await platform.getByRole("link", { name: "Agregar tienda" }).click();
  await expect(
    platform.getByRole("heading", { name: `Agregar tienda a Org vs${run}` }),
  ).toBeVisible();
  await platform.getByLabel("Nombre de la tienda").fill("PRUVA Mujer");
  await platform.getByLabel("Dirección de la tienda (handle)").fill(handle);
  await platform.getByRole("button", { name: "Agregar tienda" }).click();
  await expect(platform.getByText(new RegExp(`^Tienda creada en ${handle}\\.`))).toBeVisible();
  await expectNoSeriousA11yViolations(platform);
  // Repetir la dirección no crea otra.
  await platform.getByLabel("Nombre de la tienda").fill("Otra PRUVA");
  await platform.getByLabel("Dirección de la tienda (handle)").fill(handle);
  await platform.getByRole("button", { name: "Agregar tienda" }).click();
  await expect(
    platform.getByText("Ya existe una tienda con esa dirección. Elige otra."),
  ).toBeVisible();
  await platform.context().close();

  // 2. La dueña ve las dos en «Tus tiendas», con su estado.
  await loginNewStaff(page, ownerEmail);
  await page.goto("/admin");
  const list = page.getByRole("list", { name: "Tus tiendas" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").filter({ hasText: "PRUVA Mujer" })).toContainText(
    "Borrador",
  );
  await expectNoSeriousA11yViolations(page);

  // 3. Desde el panel de la primera, el selector dice cuántas hay y cambia a la otra.
  await page.goto(`/admin/${tenant.handle}`);
  const switcher = page.getByText("Cambiar de tienda (2)");
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page
    .getByRole("list", { name: "Cambiar de tienda" })
    .getByRole("link", { name: /PRUVA Mujer/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/admin/${handle}$`));

  // 4. Cada tienda tiene su catálogo: el producto de la primera no está en la nueva.
  await page.goto(`/admin/${handle}/productos`);
  await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
  await expect(page.getByText("Proteína de la primera tienda")).toHaveCount(0);
  await page.goto(`/admin/${tenant.handle}/productos`);
  await expect(page.getByText("Proteína de la primera tienda").first()).toBeVisible();

  // 5. La tienda nueva copia la estructura de la primera, sin productos.
  await page.goto(`/admin/${handle}/configuracion`);
  const copy = page.getByRole("region", { name: "Copiar de otra de tus tiendas" });
  await expect(copy.getByLabel("Copiar de")).toHaveValue(tenant.storeId);
  await copy.getByRole("button", { name: "Copiar a esta tienda" }).click();
  await expect(copy.getByText(/^Copiamos 1 categoría/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.goto(`/admin/${handle}/productos/categorias`);
  await expect(page.getByLabel("Nombre de Proteínas veganas")).toHaveValue("Proteínas veganas");
  await page.goto(`/admin/${handle}/productos`);
  await expect(page.getByText("Proteína de la primera tienda")).toHaveCount(0);

  const [row] = await admin<{ org: string; status: string }[]>`
    select organization_id::text as org, status from public.stores where handle = ${handle}`;
  expect(row).toEqual({ org: tenant.orgId, status: "draft" });
});
