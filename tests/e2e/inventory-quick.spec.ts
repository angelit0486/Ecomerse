import { expect, test, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * Inventario más fácil (panel, 2026-11-26): «En mano» editable en cada fila con
 * un solo «Guardar cambios», «Marcar agotado» por variante (no toca lo apartado
 * para pedidos) y «Marcar como agotado» en bloque desde Productos. Todo por
 * inventory_adjust: cada cambio deja su movimiento con motivo.
 */
const run = uniq();
const ownerEmail = `inv-rapido-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const ids: Record<string, string> = {};
// Una sola sesión para las tres pruebas (la segunda vez la cuenta ya tiene 2 pasos).
let page: Page;

async function product(title: string, slug: string, onHand: number, reserved = 0) {
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, ${title}, ${slug}, 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`${slug}-${run}`.toUpperCase()}, 25000, '') returning id`;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', ${onHand}, 0)
                from public.inventory_levels l where l.variant_id = ${v!.id}`;
  if (reserved > 0) {
    await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'reservation', 0, ${reserved})
                  from public.inventory_levels l where l.variant_id = ${v!.id}`;
  }
  ids[slug] = v!.id;
}

const level = async (slug: string) =>
  (
    await admin<{ on_hand: number; reserved: number }[]>`
      select on_hand, reserved from public.inventory_levels where variant_id = ${ids[slug]!}`
  )[0]!;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  tenant = await createTenant(`iq${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await product("Gorra roja", "gorra-roja", 10);
  await product("Gorra azul", "gorra-azul", 6, 2);
  await product("Gorra verde", "gorra-verde", 4);
});

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await loginNewStaff(page, ownerEmail);
});

test.afterAll(async () => {
  await page?.close();
});

test("cambiar «En mano» de varias filas y guardar una sola vez", async () => {
  await page.goto(`/admin/${tenant.handle}/inventario`);
  const roja = page.getByLabel("En mano de Gorra roja");
  const azul = page.getByLabel("En mano de Gorra azul");
  await expect(roja).toHaveValue("10");
  await expectNoSeriousA11yViolations(page);

  // Menos que lo apartado para pedidos: no se guarda nada y se dice cuál.
  await roja.fill("8");
  await azul.fill("1");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Gorra azul" })).toContainText(
    "no menor que lo apartado",
  );
  expect((await level("gorra-roja")).on_hand).toBe(10);
  await expect(roja).toHaveValue("8");

  await azul.fill("9");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "2 existencias actualizadas." }),
  ).toBeVisible();
  expect(await level("gorra-roja")).toEqual({ on_hand: 8, reserved: 0 });
  expect(await level("gorra-azul")).toEqual({ on_hand: 9, reserved: 2 });

  // Tras recargar se ven las cifras guardadas; sin cambios, no se mueve nada.
  await page.reload();
  await expect(page.getByLabel("En mano de Gorra roja")).toHaveValue("8");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "No cambiaste ninguna cantidad." }),
  ).toBeVisible();

  const [moves] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.inventory_movements m
      join public.inventory_levels l on l.id = m.level_id
     where l.variant_id in (${ids["gorra-roja"]!}, ${ids["gorra-azul"]!})
       and m.reason = 'Actualización rápida de inventario desde el panel'`;
  expect(moves!.n).toBe(2);
});

test("«Marcar agotado» deja el disponible en 0 sin tocar lo apartado", async () => {
  await page.goto(`/admin/${tenant.handle}/inventario`);
  await page.getByRole("button", { name: "Marcar agotado: Gorra azul" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 variante marcada como agotada." }),
  ).toBeVisible();
  // En mano = apartado (2): esos pedidos siguen teniendo su mercancía.
  expect(await level("gorra-azul")).toEqual({ on_hand: 2, reserved: 2 });
  await expect(page.getByRole("button", { name: "Marcar agotado: Gorra azul" })).toHaveCount(0);
  await expect(page.getByLabel("Existencias de Gorra azul")).toContainText("Agotado");

  // Reponer y volver a agotar: la segunda vez también mueve (clave nueva).
  await page.getByLabel("En mano de Gorra azul").fill("7");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 existencia actualizada." }),
  ).toBeVisible();
  // El aviso anterior ya no aplica: se fue al reponer.
  await expect(
    page.getByRole("status").filter({ hasText: "1 variante marcada como agotada." }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Marcar agotado: Gorra azul" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 variante marcada como agotada." }),
  ).toBeVisible();
  await expect.poll(() => level("gorra-azul")).toEqual({ on_hand: 2, reserved: 2 });

  const [ledger] = await admin<{ mismatches: number }[]>`
    select count(*)::int as mismatches from system.inventory_ledger_mismatches() where store_id = ${tenant.storeId}`;
  expect(ledger!.mismatches).toBe(0);
});

test("«Marcar como agotado» en bloque desde Productos y la tienda lo muestra", async () => {
  await page.goto(`/admin/${tenant.handle}/productos`);
  await page.getByRole("checkbox", { name: "Seleccionar Gorra verde" }).check();
  await page.getByRole("checkbox", { name: "Seleccionar Gorra azul" }).check();
  await page.getByLabel("Acción masiva").selectOption("soldout");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.getByRole("button", { name: "Sí, marcar agotado" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 variante marcada como agotada." }),
  ).toContainText("1 ya estaba agotada.");
  expect(await level("gorra-verde")).toEqual({ on_hand: 0, reserved: 0 });
  // La que no se eligió sigue igual.
  expect((await level("gorra-roja")).on_hand).toBe(8);

  await page.goto(`http://${tenant.handle}.localhost:3000/productos/gorra-verde`);
  await expect(page.getByText("Agotado").first()).toBeVisible();
});
