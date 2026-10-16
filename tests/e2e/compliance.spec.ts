import { expect, test, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  enterEmailCode,
  expectNoSeriousA11yViolations,
  freshTotp,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * R-T02 y R-T03 (ADR-021): la dueña declara que vende suplementos, prepara la
 * ficha sanitaria de un producto y no lo puede publicar hasta que la plataforma
 * revise las reglas de México (con el texto que da el asesor; aquí, de prueba).
 * Publicado, la tienda muestra la ficha y las leyendas; otra tienda no cambia.
 */
const run = uniq();
const ownerEmail = `suplementos-${run}@example.test`;
const adminEmail = `padmin-c-${run}@platform.test`;
const LEGEND = `TEXTO DE PRUEBA DEL ASESOR ${run}`;
const PURCHASE_LEGEND = `LEYENDA DE COMPRA DE PRUEBA ${run}`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let other: Awaited<ReturnType<typeof createTenant>>;
let productId = "";
let ownerSecret = "";
let seededRuleIds: string[] = [];
let profileBefore: {
  id: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
};

/** Acceso de un staff que ya activó la verificación en dos pasos. */
async function loginAgain(page: Page, email: string, secret: string) {
  const sentAt = Date.now() - 1000;
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await enterEmailCode(page, email, sentAt);
  await page.getByLabel("Código de la app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  // Las reglas de esta corrida se retiran y vuelven las propuestas.
  await admin`update public.compliance_rules set status = 'retired'
               where profile_id = ${profileBefore.id} and status = 'active'
                 and not (id = any (${seededRuleIds}::uuid[]))`;
  await admin`update public.compliance_rules set status = 'active' where id = any (${seededRuleIds}::uuid[])`;
  await admin`update public.compliance_profiles
                 set status = ${profileBefore.status}, reviewed_by = ${profileBefore.reviewed_by},
                     reviewed_at = ${profileBefore.reviewed_at}, review_notes = ${profileBefore.review_notes}
               where id = ${profileBefore.id}`;
});

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`s${run}`, ownerId);
  const adminId = await createAuthUser(adminEmail);
  await admin`insert into public.platform_staff (user_id, role) values (${adminId}, 'platform_admin')`;
  // El perfil de México es de la plataforma: cada corrida empieza sin reglas
  // vigentes ni revisión. Las reglas propuestas (Fase A) se retiran, no se
  // borran, y se restauran al terminar.
  const before = await admin<
    {
      id: string;
      status: string;
      reviewed_by: string | null;
      reviewed_at: Date | null;
      review_notes: string | null;
    }[]
  >`
    select id, status, reviewed_by, reviewed_at, review_notes from public.compliance_profiles
     where country = 'MX' and category_key = 'dietary_supplement'`;
  profileBefore = before[0]!;
  seededRuleIds = (
    await admin<{ id: string }[]>`
      update public.compliance_rules set status = 'retired'
       where profile_id = ${profileBefore.id} and status = 'active' returning id`
  ).map((r) => r.id);
  await admin`update public.compliance_profiles
                 set status = 'pending', reviewed_by = null, reviewed_at = null, review_notes = null
               where id = ${profileBefore.id}`;
  productId = await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Omega 3",
        variants: [{ price: 29900, sku: `OMEGA-${run}` }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`OMEGA-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 10, 'Inicial')`;
    return p!.r.id;
  });
  const otherOwner = await createAuthUser(`no-regulada-${run}@example.test`);
  other = await createTenant(`n${run}`, otherOwner);
  await admin`update public.stores set status = 'active', launched_at = now()
               where id in (${tenant.storeId}, ${other.storeId})`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: otherOwner, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${other.storeId}, ${sql.json({
        title: "Omega 3",
        variants: [{ price: 19900 }],
      })}) as r`;
    await sql`select public.catalog_publish_product(${other.storeId}, ${p!.r.id})`;
  });
});

test("la dueña declara suplementos y prepara la ficha; con reglas pendientes no publica", async ({
  page,
}) => {
  ownerSecret = await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;

  await page.goto(`${base}/ajustes/cumplimiento`);
  await expect(page.getByRole("heading", { name: "Cumplimiento sanitario" })).toBeVisible();
  await expect(page.getByText("aún no están revisadas por la plataforma")).toBeVisible();
  await page.getByRole("button", { name: "Vendo suplemento alimenticio" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Categoría declarada." })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.goto(`${base}/productos/${productId}`);
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Indica en la ficha sanitaria si es un suplemento" }),
  ).toBeVisible();

  const sheet = page.getByRole("region", { name: "Ficha sanitaria" });
  await sheet.getByRole("radio", { name: "Suplemento alimenticio" }).check();
  await sheet.getByLabel("Presentación").fill("Cápsulas");
  await sheet.getByLabel("Ingredientes").fill("Aceite de pescado");
  await sheet.getByLabel("Nutrimento del renglón 1").fill("Omega 3");
  await sheet.getByLabel("Cantidad del renglón 1").fill("1000");
  await sheet.getByLabel("Unidad del renglón 1").fill("mg");
  await sheet.getByRole("button", { name: "Agregar renglón" }).click();
  await sheet.getByLabel("Nutrimento del renglón 2").fill("EPA");
  await sheet.getByLabel("Cantidad del renglón 2").fill("180");
  await sheet.getByRole("button", { name: "Guardar ficha sanitaria" }).click();
  await expect(
    sheet.getByRole("status").filter({ hasText: "Ficha sanitaria guardada." }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [info] = await admin<{ category_key: string; data: Record<string, unknown> }[]>`
    select category_key, data from public.product_regulatory_info where product_id = ${productId}`;
  expect(info).toEqual({
    category_key: "dietary_supplement",
    data: {
      form: "Cápsulas",
      ingredients: "Aceite de pescado",
      nutrition: [
        { name: "Omega 3", amount: "1000", unit: "mg" },
        { name: "EPA", amount: "180" },
      ],
    },
  });

  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Las reglas sanitarias de esta categoría aún no están revisadas" }),
  ).toBeVisible();
});

test("la plataforma captura las reglas del asesor y las marca como revisadas", async ({ page }) => {
  await loginNewStaff(page, adminEmail);
  await page.goto("/platform/cumplimiento");
  await expect(page.getByRole("heading", { name: "Cumplimiento" })).toBeVisible();

  const rule = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Agregar o editar una regla" }) });
  await rule.getByLabel("Tipo de regla").selectOption("required_field");
  await rule.getByLabel("Clave").fill("uso");
  await rule.getByLabel("Nombre").fill("Modo de uso");
  await rule.getByLabel("Campo de la ficha").selectOption("usage");
  await rule.getByRole("button", { name: "Guardar regla" }).click();
  await expect(rule.getByRole("status").filter({ hasText: "Regla guardada." })).toBeVisible();

  await rule.getByLabel("Tipo de regla").selectOption("required_legend");
  await rule.getByLabel("Clave").fill("leyenda_prueba");
  await rule.getByLabel("Nombre").fill("Leyenda de prueba");
  await rule.getByLabel("Texto de la leyenda").fill(LEGEND);
  await rule.getByRole("button", { name: "Guardar regla" }).click();
  await expect(page.getByRole("cell", { name: LEGEND })).toBeVisible();

  await rule.getByLabel("Clave").fill("leyenda_compra");
  await rule.getByLabel("Nombre").fill("Leyenda de compra");
  await rule.getByLabel("Texto de la leyenda").fill(PURCHASE_LEGEND);
  await rule.getByRole("checkbox", { name: "Ficha del producto" }).uncheck();
  await rule.getByRole("checkbox", { name: "Carrito" }).check();
  await rule.getByRole("checkbox", { name: "Checkout" }).check();
  await rule.getByRole("button", { name: "Guardar regla" }).click();
  await expect(page.getByRole("cell", { name: PURCHASE_LEGEND })).toBeVisible();

  const review = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Revisión de las reglas" }) });
  await review.getByLabel("Revisó").fill("Asesoría de prueba E2E");
  await review.getByRole("button", { name: "Guardar estado" }).click();
  await expect(
    review.getByRole("status").filter({ hasText: "Reglas marcadas como revisadas." }),
  ).toBeVisible();
  await expect(page.getByText("revisó Asesoría de prueba E2E")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("con las reglas revisadas, el campo obligatorio se completa y el producto se publica", async ({
  page,
}) => {
  await loginAgain(page, ownerEmail, ownerSecret);
  await page.goto(`/admin/${tenant.handle}/productos/${productId}`);
  const sheet = page.getByRole("region", { name: "Ficha sanitaria" });
  await expect(sheet.getByText(LEGEND)).toBeVisible();

  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Falta en la ficha sanitaria: modo de uso." }),
  ).toBeVisible();

  await sheet.getByLabel("Modo de uso").fill("Tomar dos cápsulas al día con alimentos.");
  await sheet.getByRole("button", { name: "Guardar ficha sanitaria" }).click();
  await expect(
    sheet.getByRole("status").filter({ hasText: "Ficha sanitaria guardada." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "publicado" })).toBeVisible();
  const [product] = await admin<
    { status: string }[]
  >`select status from public.products where id = ${productId}`;
  expect(product!.status).toBe("active");
});

test("la tienda muestra la ficha y las leyendas; la tienda no regulada no cambia", async ({
  page,
}) => {
  await page.goto(`http://${tenant.handle}.localhost:3000/productos/omega-3`);
  const info = page.getByRole("region", { name: "Información del suplemento alimenticio" });
  await expect(info).toBeVisible();
  await expect(info.getByRole("note", { name: "Leyendas sanitarias" })).toHaveText(LEGEND);
  await expect(info.getByText(PURCHASE_LEGEND)).toHaveCount(0);
  const table = info.getByRole("table", { name: "Información nutrimental" });
  await expect(table.getByRole("rowheader", { name: "Omega 3" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "1000 mg" })).toBeVisible();
  await expect(info.getByText("Tomar dos cápsulas al día con alimentos.")).toBeVisible();
  // El JSON-LD sigue siendo el Product de siempre: ni la ficha, ni leyendas, ni
  // propiedades de salud o valoraciones (ADR-021).
  const ld = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  ) as { "@graph": Array<Record<string, unknown>> };
  expect(ld["@graph"].map((n) => n["@type"])).toEqual(["Product"]);
  expect(Object.keys(ld["@graph"][0]!).sort()).toEqual(["@type", "name", "offers", "sku", "url"]);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page
    .getByRole("status")
    .getByRole("link", { name: /Ver carrito/ })
    .click();
  await expect(page.getByRole("note", { name: "Leyendas sanitarias" })).toHaveText(PURCHASE_LEGEND);
  await page.getByRole("link", { name: "Continuar al pago" }).click();
  await expect(page.getByRole("note", { name: "Leyendas sanitarias" })).toHaveText(PURCHASE_LEGEND);

  await page.goto(`http://${other.handle}.localhost:3000/productos/omega-3`);
  await expect(page.getByRole("heading", { name: "Omega 3", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: /Información del/ })).toHaveCount(0);
  await expect(page.getByRole("note", { name: "Leyendas sanitarias" })).toHaveCount(0);
});

test("editar la ficha de un producto publicado se ve al instante en la tienda", async ({
  page,
}) => {
  // La prueba anterior dejó la ficha en la caché de datos de la tienda (TTL 60 s):
  // sin invalidar al guardar, la tienda seguiría mostrando el texto anterior.
  await loginAgain(page, ownerEmail, ownerSecret);
  await page.goto(`/admin/${tenant.handle}/productos/${productId}`);
  const sheet = page.getByRole("region", { name: "Ficha sanitaria" });
  await sheet.getByLabel("Modo de uso").fill("Tomar una cápsula al día.");
  await sheet.getByRole("button", { name: "Guardar ficha sanitaria" }).click();
  await expect(
    sheet.getByRole("status").filter({ hasText: "Ficha sanitaria guardada." }),
  ).toBeVisible();

  await page.goto(`http://${tenant.handle}.localhost:3000/productos/omega-3`);
  const info = page.getByRole("region", { name: "Información del suplemento alimenticio" });
  await expect(info.getByText("Tomar una cápsula al día.")).toBeVisible();
  await expect(info.getByText("Tomar dos cápsulas al día con alimentos.")).toHaveCount(0);
});

test("Fase A: leyenda de la tienda — el borrador sugerido no se aprueba; la aprobada se publica y desbloquea", async ({
  page,
}) => {
  // La regla propuesta `leyenda_tienda` vuelve a estar vigente (sin revisión en cola:
  // el validador de la tienda debe señalar el producto publicado que ya no cumple).
  await admin`update public.compliance_rules set status = 'active'
               where profile_id = ${profileBefore.id} and key = 'leyenda_tienda'`;
  const STORE_LEGEND = `LEYENDA DE LA TIENDA REVISADA ${run}`;
  await loginAgain(page, ownerEmail, ownerSecret);
  await page.goto(`/admin/${tenant.handle}/ajustes/cumplimiento`);

  const blocked = page.getByRole("region", { name: "Productos que no se pueden publicar" });
  await expect(blocked.getByRole("link", { name: "Omega 3" })).toBeVisible();
  await expect(blocked.getByText("Falta aprobar la leyenda sanitaria de tu tienda")).toBeVisible();

  const legend = page.getByRole("region", { name: "Leyenda sanitaria de tu tienda" });
  const body = legend.getByLabel("Texto de la leyenda (borrador)");
  await expect(body).toHaveValue(/^PENDIENTE DE REVISIÓN/);
  await legend.getByLabel("Revisado por (para aprobar)").fill("Asesoría de prueba E2E");
  await legend.getByRole("checkbox").check();
  await legend.getByRole("button", { name: "Aprobar y publicar leyenda" }).click();
  await expect(legend.getByRole("alert")).toContainText("PENDIENTE DE REVISIÓN");

  await legend.getByLabel("Texto de la leyenda (borrador)").fill(STORE_LEGEND);
  await legend.getByRole("checkbox").check();
  await legend.getByRole("button", { name: "Aprobar y publicar leyenda" }).click();
  await expect(legend.getByRole("status").filter({ hasText: "Leyenda aprobada" })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Productos que no se pueden publicar" }),
  ).toContainText("Todos tus productos cumplen");

  await page.goto(`http://${tenant.handle}.localhost:3000/productos/omega-3`);
  await expect(page.getByRole("note", { name: "Leyendas sanitarias" })).toContainText(STORE_LEGEND);
});
