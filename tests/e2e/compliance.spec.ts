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
 * R-T02 (ADR-021): la dueña declara que vende suplementos, prepara la ficha
 * sanitaria de un producto y no lo puede publicar hasta que la plataforma revise
 * las reglas de México (con el texto que da el asesor; aquí, de prueba).
 */
const run = uniq();
const ownerEmail = `suplementos-${run}@example.test`;
const adminEmail = `padmin-c-${run}@platform.test`;
const LEGEND = `TEXTO DE PRUEBA DEL ASESOR ${run}`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let productId = "";
let ownerSecret = "";

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

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`s${run}`, ownerId);
  const adminId = await createAuthUser(adminEmail);
  await admin`insert into public.platform_staff (user_id, role) values (${adminId}, 'platform_admin')`;
  // El perfil de México es de la plataforma: cada corrida empieza sin reglas ni revisión.
  await admin`delete from public.compliance_rules
               where profile_id = (select id from public.compliance_profiles
                                    where country = 'MX' and category_key = 'dietary_supplement')`;
  await admin`update public.compliance_profiles
                 set status = 'pending', reviewed_by = null, reviewed_at = null, review_notes = null
               where country = 'MX' and category_key = 'dietary_supplement'`;
  productId = await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Omega 3",
        variants: [{ price: 29900, sku: `OMEGA-${run}` }],
      })}) as r`;
    return p!.r.id;
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
