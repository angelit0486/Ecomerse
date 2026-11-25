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
 * ADR-070, fase 2 · Panel de promociones: la dueña crea un 3×2 para un producto
 * (queda en borrador), la activa, choca con el límite de su plan (2 activas),
 * pausa una para activar otra, edita la leyenda y marca un cupón como
 * combinable. La tienda pública no cambia en esta fase.
 */
const run = uniq();
const ownerEmail = `promo-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`pm${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  // Límite del plan para esta organización (excepción; el plan e2e no se toca).
  await admin`insert into public.organization_entitlement_overrides (organization_id, key, value_int, reason)
              values (${tenant.orgId}, 'max_active_promotions', 2, 'Prueba E2E de promociones')`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
      title: "Playera básica",
      variants: [{ price: 19900, sku: `PLY-${run}`.toUpperCase() }],
    })})`;
  });
});

test("crear, activar, límite del plan, pausar y editar una promoción; cupón combinable", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Promociones" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Promociones" })).toBeVisible();
  await expect(page.getByText("Aún no tienes promociones")).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Promociones activas: 0 de 2");
  await expectNoSeriousA11yViolations(page);

  // 1. 3×2 en un producto: se guarda en borrador.
  await page.getByRole("link", { name: "Nueva promoción" }).click();
  await page.getByLabel("Nombre interno").fill("Playeras 3x2");
  await page.getByLabel("Leyenda para el cliente").fill("3×2 en playeras");
  await expect(page.getByText("El cliente verá: Lleva 3, paga 2")).toBeVisible();
  await expect(page.getByText(/si lleva 3, paga \$200\.00 en vez de \$300\.00/)).toBeVisible();
  await page.getByRole("radio", { name: /^Productos/ }).check();
  // Sin producto elegido, la base no recibe nada: el formulario lo dice.
  await page.getByRole("button", { name: "Guardar como borrador" }).click();
  await expect(page.getByText("Elige al menos un producto o categoría").first()).toBeVisible();
  await page.getByLabel("Buscar un producto para agregar").fill("playera");
  await page.getByRole("button", { name: "Agregar Playera básica" }).click();
  await expect(page.getByText("Productos elegidos (1)")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Guardar como borrador" }).click();
  await expect(page.getByText("Promoción creada en borrador.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Playeras 3x2" })).toBeVisible();
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();

  // 2. Activar.
  await page.getByRole("button", { name: "Activar Playeras 3x2" }).click();
  await expect(page.getByText("Promoción activada: ya se aplica en el carrito.")).toBeVisible();
  await expect(page.getByText("Activa", { exact: true })).toBeVisible();

  // 3. Dos más: la segunda al 50 % (activa) y mayoreo (choca con el límite de 2).
  const create = async (name: string, setup: () => Promise<void>) => {
    await page.goto(`/admin/${tenant.handle}/promociones/nueva`);
    await page.getByLabel("Nombre interno").fill(name);
    await page.getByLabel("Leyenda para el cliente").fill(name);
    await setup();
    await page.getByRole("button", { name: "Guardar como borrador" }).click();
    await expect(page.getByText("Promoción creada en borrador.")).toBeVisible();
    await page.getByRole("button", { name: `Activar ${name}` }).click();
  };
  await create("Segunda al 50", async () => {
    await page.getByRole("radio", { name: /Descuento en la N-ésima pieza/ }).check();
    await expect(page.getByText("El cliente verá: La segunda al 50% de descuento")).toBeVisible();
  });
  await expect(page.getByText("Promoción activada: ya se aplica en el carrito.")).toBeVisible();
  await create("Mayoreo 6", async () => {
    await page.getByRole("radio", { name: /Mayoreo/ }).check();
    await page.getByLabel("Escalón 1: desde (piezas)").fill("6");
    await page.getByLabel("Escalón 1: precio por pieza (MXN)").fill("150");
    await page.getByRole("button", { name: "Agregar escalón" }).click();
    await page.getByLabel("Escalón 2: desde (piezas)").fill("12");
    await page.getByLabel("Escalón 2: precio por pieza (MXN)").fill("130");
    await expect(
      page.getByText(/Desde 6: \$150\.00 c\/u · Desde 12: \$130\.00 c\/u/),
    ).toBeVisible();
  });
  await expect(
    page.getByText(/Llegaste al límite de tu plan: 2 promociones activas/),
  ).toBeVisible();

  // 4. En la lista: pausar una libera el lugar.
  await page.goto(`/admin/${tenant.handle}/promociones`);
  await expect(page.getByRole("note")).toContainText("Promociones activas: 2 de 2");
  const list = page.getByRole("list", { name: "Promociones" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Pausar Segunda al 50" }).click();
  await expect(page.getByText("Promoción pausada.")).toBeVisible();
  await page.getByRole("button", { name: "Activar Mayoreo 6" }).click();
  await expect(page.getByText("Promoción activada: ya se aplica en el carrito.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("note")).toContainText("Promociones activas: 2 de 2");

  // 5. Editar: la leyenda cambia; la regla se conserva.
  await page.getByRole("link", { name: "Playeras 3x2" }).click();
  await expect(page.getByLabel("Lleva (piezas)")).toHaveValue("3");
  await expect(page.getByText("Productos elegidos (1)")).toBeVisible();
  await page.getByLabel("Leyenda para el cliente").fill("3×2 en playeras (diciembre)");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Promoción guardada.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("3×2 en playeras (diciembre)").first()).toBeVisible();

  const rows = await admin<{ name: string; status: string; targets: number }[]>`
    select p.name, p.status, (select count(*)::int from public.promotion_targets t where t.promotion_id = p.id) as targets
      from public.promotions p where p.store_id = ${tenant.storeId} order by p.created_at`;
  expect(rows).toEqual([
    { name: "Playeras 3x2", status: "active", targets: 1 },
    { name: "Segunda al 50", status: "paused", targets: 0 },
    { name: "Mayoreo 6", status: "active", targets: 0 },
  ]);

  // 6. Cupones: la casilla «Se combina con promociones» llega a la base.
  await page.goto(`/admin/${tenant.handle}/descuentos`);
  const code = `JUNTOS${run}`.toUpperCase().slice(0, 20);
  await page.getByLabel("Código").first().fill(code);
  await page.getByLabel("Porcentaje (%)").first().fill("10");
  await page.getByLabel("Se combina con promociones").first().check();
  await page.getByRole("button", { name: "Crear descuento" }).click();
  await expect(page.getByText("Descuento creado.")).toBeVisible();
  await expect(page.getByText(/se combina con promociones/).first()).toBeVisible();
  const [d] = await admin<{ c: boolean }[]>`
    select combines_with_promotions as c from public.discounts where store_id = ${tenant.storeId} and code = ${code}`;
  expect(d!.c).toBe(true);
});
