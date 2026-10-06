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
 * F4-T03: inventario en el panel — ajuste con motivo obligatorio, daño, fijar
 * la cantidad contada, aviso de stock bajo, filtro e historial inmutable.
 */
const run = uniq();
const ownerEmail = `inventario-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const sku = `TAZA-${run.toUpperCase()}`;

test.beforeAll(async () => {
  tenant = await createTenant(`i${run}`, await createAuthUser(ownerEmail));
  const [product] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug) values (${tenant.storeId}, 'Taza de barro', 'taza-de-barro')
    returning id`;
  await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature)
              values (${tenant.storeId}, ${product!.id}, ${sku}, 15000, '')`;
});

test("inventario: ajustar con motivo, daño, fijar, aviso de stock bajo e historial", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}/inventario`;
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Inventario" }).click();
  await expect(page.getByRole("heading", { name: /Taza de barro/ })).toBeVisible();
  const stock = page.getByRole("definition");
  await expectNoSeriousA11yViolations(page);

  await page.getByText("Ajustar existencias o aviso").click();
  const qty = page.getByLabel("Cantidad de Taza de barro");
  const reason = page.getByRole("textbox", { name: "Motivo" });

  // Sin motivo no se ajusta; lo escrito no se pierde.
  await qty.fill("12");
  await page.getByRole("button", { name: "Guardar ajuste" }).click();
  await expect(page.getByText("Escribe el motivo (de 3 a 500 caracteres).")).toBeVisible();
  await expect(qty).toHaveValue("12");

  await reason.fill("Conteo inicial");
  await page.getByRole("button", { name: "Guardar ajuste" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Listo: 12 en mano, 12 disponibles." }),
  ).toBeVisible();

  await page.getByLabel("Tipo").selectOption("damage");
  await page.getByLabel("Cantidad de Taza de barro").fill("2");
  await page.getByRole("textbox", { name: "Motivo" }).fill("Llegaron rotas");
  await page.getByRole("button", { name: "Guardar ajuste" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Listo: 10 en mano" })).toBeVisible();

  // Más de lo que hay: rechazado por la base.
  await page.getByLabel("Tipo").selectOption("loss");
  await page.getByLabel("Cantidad de Taza de barro").fill("50");
  await page.getByRole("textbox", { name: "Motivo" }).fill("Extravío");
  await page.getByRole("button", { name: "Guardar ajuste" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "menos de 0 unidades" })).toBeVisible();

  await page.getByLabel("Tipo").selectOption("adjustment");
  await page.getByLabel("Cómo").selectOption("set");
  await page.getByLabel("Cantidad de Taza de barro").fill("3");
  await page.getByRole("textbox", { name: "Motivo" }).fill("Conteo del sábado");
  await page.getByRole("button", { name: "Guardar ajuste" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Listo: 3 en mano, 3 disponibles." }),
  ).toBeVisible();

  await page.getByLabel("Avisar con stock bajo de Taza de barro").fill("5");
  await page.getByRole("button", { name: "Guardar aviso" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Aviso de stock bajo en 5." }),
  ).toBeVisible();

  await page.goto(`${base}?bajo=1`);
  await expect(page.getByText("Stock bajo", { exact: true })).toBeVisible();
  await expect(stock.filter({ hasText: /^3/ }).first()).toBeVisible();

  await page.getByRole("link", { name: "Historial de Taza de barro" }).click();
  const rows = page.getByRole("row");
  await expect(rows).toHaveCount(4); // encabezado + 3 movimientos (el rechazado no deja rastro)
  await expect(page.getByRole("cell", { name: "Conteo del sábado" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Llegaron rotas" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [ledger] = await admin<{ mismatches: number }[]>`
    select count(*)::int as mismatches from system.inventory_ledger_mismatches() where store_id = ${tenant.storeId}`;
  expect(ledger!.mismatches).toBe(0);
});
