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
 * Pulido, Paso 2: las políticas que nacen de plantilla se marcan «Pendiente de
 * revisión legal» y una página nueva puede empezar desde una plantilla
 * (Contacto, Preguntas frecuentes, Nosotros) con sus bloques en el borrador.
 */
const run = uniq();
const email = `paginas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`pg${run}`, await createAuthUser(email));
});

test("políticas pendientes de revisión legal y página desde plantilla", async ({ page }) => {
  await loginNewStaff(page, email);
  await page.goto(`/admin/${tenant.handle}/contenido`);
  const pages = page.getByRole("region", { name: "Páginas" });
  await expect(pages.getByText("Pendiente de revisión legal")).toHaveCount(4);
  await expectNoSeriousA11yViolations(page);

  await pages.getByRole("link", { name: "Aviso de privacidad" }).click();
  await expect(page.getByRole("heading", { name: "Aviso de privacidad", level: 1 })).toBeVisible();
  await expect(page.getByText("Pendiente de revisión legal", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Mientras tenga marcadores, la tienda no se puede publicar/),
  ).toBeVisible();

  await page.goto(`/admin/${tenant.handle}/contenido`);
  await page.getByLabel("Empezar con").selectOption({ label: "Plantilla: Contacto" });
  await page.getByRole("button", { name: "Crear página" }).click();
  await expect(page.getByRole("heading", { name: "Contacto", level: 1 })).toBeVisible();

  const [row] = await admin<{ types: string[]; published: boolean; body: string }[]>`
    select array(select s ->> 'type' from jsonb_array_elements(draft_sections) s) as types,
           is_published as published, body_html as body
      from public.store_pages where store_id = ${tenant.storeId} and slug = 'contacto'`;
  expect(row).toMatchObject({ types: ["contact_map", "faq"], published: false });
  expect(row!.body).toContain("[Escribe cómo prefieres que te contacten");
  await expectNoSeriousA11yViolations(page);
});
