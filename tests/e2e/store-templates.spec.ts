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
 * ADR-034 §5: plantilla por giro en «Configura tu tienda». Deja estilo, portada,
 * categorías y productos de ejemplo en borrador; los ejemplos bloquean el
 * lanzamiento hasta quitarlos.
 */
const run = uniq();
const ownerEmail = `plantilla-${run}@example.test`;
const blankEmail = `blanco-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let blank: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`t${run}`, await createAuthUser(ownerEmail));
  blank = await createTenant(`b${run}`, await createAuthUser(blankEmail));
});

test("plantilla Ropa: borrador con ejemplos marcados, bloqueo y quitar ejemplos", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/configuracion`);
  // Recorrido guiado: cada paso lleva a su pantalla.
  const steps = page.getByRole("list", { name: "Pasos de configuración" });
  await expect(steps.getByRole("link")).toHaveCount(10);
  await expect(steps.getByRole("link", { name: /^Impuestos/ })).toHaveAttribute(
    "href",
    `/admin/${tenant.handle}/impuestos`,
  );
  await expect(steps.getByRole("link", { name: /^Dominio propio/ })).toContainText("Opcional");
  const section = page.getByRole("region", { name: "Plantilla por giro" });
  await expect(section.getByRole("radio")).toHaveCount(6);
  await expectNoSeriousA11yViolations(page);

  await section.getByRole("radio", { name: /^Ropa/ }).check();
  await section.getByRole("button", { name: "Aplicar plantilla" }).click();
  await expect(
    page.getByText("Plantilla «Ropa» aplicada al borrador con 4 productos de ejemplo."),
  ).toBeVisible();
  await expect(page.getByText("Tu tienda tiene 4 productos de ejemplo")).toBeVisible();
  const pending = page.getByRole("list", { name: "Pendientes para publicar" });
  await expect(pending.getByText("Quita los productos de ejemplo")).toBeVisible();

  const [theme] = await admin<{ primary: string; heading: string; sections: number }[]>`
    select draft_settings #>> '{colors,primary}' as primary,
           draft_settings #>> '{typography,heading}' as heading,
           jsonb_array_length(draft_home_sections) as sections
      from public.store_themes where store_id = ${tenant.storeId}`;
  expect(theme).toEqual({ primary: "#2b2d42", heading: "playfair-display", sections: 5 });
  const products = await admin<{ title: string; status: string }[]>`
    select title, status from public.products
     where store_id = ${tenant.storeId} and deleted_at is null order by title`;
  expect(products.map((p) => p.status)).toEqual(["draft", "draft", "draft", "draft"]);
  expect(products.every((p) => p.title.startsWith("Ejemplo · "))).toBe(true);

  // Los ejemplos se ven en el catálogo del panel, marcados en el título.
  await page.goto(`/admin/${tenant.handle}/productos`);
  await expect(page.getByText("Ejemplo · Gorra de gabardina").first()).toBeVisible();

  await page.goto(`/admin/${tenant.handle}/configuracion`);
  await page.getByRole("button", { name: "Quitar los 4 productos de ejemplo" }).click();
  await page.getByRole("button", { name: "Sí, quitar los 4 productos de ejemplo" }).click();
  await expect(page.getByText("Se quitaron 4 productos de ejemplo.")).toBeVisible();
  await expect(pending.getByText("Quita los productos de ejemplo")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
});

test("plantilla «En blanco»: borrador sin bloques, sin ejemplos y sin categoría regulada", async ({
  page,
}) => {
  await loginNewStaff(page, blankEmail);
  await page.goto(`/admin/${blank.handle}/configuracion`);
  const section = page.getByRole("region", { name: "Plantilla por giro" });
  await section.getByRole("radio", { name: /^En blanco/ }).check();
  await section.getByRole("button", { name: "Aplicar plantilla" }).click();
  await expect(
    page.getByText("Plantilla «En blanco» aplicada al borrador. Revísala en la vista previa."),
  ).toBeVisible();
  await expect(page.getByText(/^Tu tienda tiene .* de ejemplo/)).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "Pendientes para publicar" })
      .getByText("Quita los productos de ejemplo"),
  ).toHaveCount(0);

  const [state] = await admin<{ sections: number; products: number; regulated: number }[]>`
    select jsonb_array_length(t.draft_home_sections)::int as sections,
           (select count(*)::int from public.products p where p.store_id = t.store_id) as products,
           (select count(*)::int from public.store_regulated_categories r
             where r.store_id = t.store_id) as regulated
      from public.store_themes t where t.store_id = ${blank.storeId}`;
  expect(state).toEqual({ sections: 0, products: 0, regulated: 0 });
  await expectNoSeriousA11yViolations(page);
});
