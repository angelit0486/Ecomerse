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
 * F5-T06: editor mínimo de páginas y menús — crear y publicar una página
 * (sanitizada), armar el menú principal y verlo en la tienda pública.
 */
const run = uniq();
const ownerEmail = `contenido-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`c${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
});

test("contenido: página publicada y menú principal visibles en la tienda", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Contenido" }).click();
  await expect(page.getByRole("heading", { name: "Contenido" })).toBeVisible();
  // Las cuatro políticas nacen como borrador.
  await expect(page.getByRole("link", { name: "Aviso de privacidad" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel("Título de la nueva página").fill("Quiénes somos");
  await page.getByRole("button", { name: "Crear página" }).click();
  await expect(page.getByText("Página creada como borrador.")).toBeVisible();
  await expect(page.getByLabel("Dirección (slug)")).toHaveValue("quienes-somos");

  // Sin contenido no se publica.
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();

  await page
    .getByLabel("Contenido")
    .fill("<h2>Nuestra historia</h2><p>Hacemos tazas a mano.</p><script>alert(1)</script>");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Página guardada." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Contenido")).not.toHaveValue(/script/);
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Página publicada." })).toBeVisible();
  await expect(page.getByLabel("Dirección (slug)")).toHaveAttribute("readonly", "");
  await expectNoSeriousA11yViolations(page);

  await page.goto(`/admin/${tenant.handle}/contenido/menus`);
  const main = page.getByRole("form", { name: "Menú principal" });
  await main.getByRole("button", { name: "Agregar enlace" }).click();
  await main.getByLabel("Texto de enlace 1").fill("Nosotros");
  await main.getByLabel("Destino de enlace 1").selectOption("page");
  await main.getByLabel("Página de enlace 1").selectOption({ label: "Quiénes somos" });
  await main.getByRole("button", { name: "Agregar enlace" }).click();
  await main.getByLabel("Texto de enlace 2").fill("Buscar");
  await main.getByLabel("Destino de enlace 2").selectOption("search");
  await main.getByRole("button", { name: "Agregar subenlace a enlace 1" }).click();
  await main.getByLabel("Texto de enlace 1.1").fill("Blog");
  await main.getByLabel("Destino de enlace 1.1").selectOption("url");
  await main.getByLabel("Dirección de enlace 1.1").fill("javascript:alert(1)");
  await main.getByRole("button", { name: "Guardar menú principal" }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await main.getByLabel("Dirección de enlace 1.1").fill("https://example.com/blog");
  await main.getByRole("button", { name: "Guardar menú principal" }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "Menú principal guardado." }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // El orden persiste tras recargar.
  await page.reload();
  await expect(main.getByLabel("Texto de enlace 1", { exact: true })).toHaveValue("Nosotros");
  await expect(main.getByLabel("Texto de enlace 2", { exact: true })).toHaveValue("Buscar");
  await expect(main.getByLabel("Texto de enlace 1.1")).toHaveValue("Blog");

  await page.goto(`http://${tenant.handle}.localhost:3000/`);
  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav.getByRole("link", { name: "Nosotros" })).toHaveAttribute(
    "href",
    "/paginas/quienes-somos",
  );
  await expect(nav.getByRole("link", { name: "Buscar" })).toBeVisible();
  await nav.getByRole("link", { name: "Nosotros" }).click();
  await expect(page.getByRole("heading", { name: "Nuestra historia" })).toBeVisible();
  expect(await page.content()).not.toContain("alert(1)");
  await expectNoSeriousA11yViolations(page);
});
