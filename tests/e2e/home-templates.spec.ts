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
 * Misión Portada/Marcas, Paso 3: plantillas de portada en el editor y
 * autoguardado en el borrador, desde el celular.
 */
const run = uniq();
const ownerEmail = `plantillas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

type Draft = { s: { type: string; props: { heading?: string } }[] | null };
const draft = async () =>
  (
    await admin<Draft[]>`
      select draft_home_sections as s from public.store_themes where store_id = ${tenant.storeId}`
  )[0]!.s;

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`pt${run}`, ownerId);
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.appearance_save_home_draft(${tenant.storeId}, ${sql.json([
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "hero",
        enabled: true,
        props: { heading: "Mi portada de antes", align: "left" },
      },
    ])}, 0)`;
  });
});

test("usar una plantilla, autoguardado y volver a como estaba", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);

  await page.getByText("Empezar con una plantilla").click();
  await page.getByLabel(/Deportivo/).check();
  await page.getByRole("button", { name: "Usar esta plantilla" }).click();
  await page.getByRole("button", { name: "Sí, usar la plantilla" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Plantilla «Deportivo» lista" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /1\. Portada principal/ })).toBeVisible();

  // Se guarda sola en el borrador, sin publicar.
  await expect(page.getByText(/Guardado en el borrador a las/)).toBeVisible({ timeout: 15_000 });
  expect((await draft())![0]!.props.heading).toBe("Entrena con lo que necesitas");
  const [published] = await admin<{ s: unknown[] }[]>`
    select home_sections as s from public.store_themes where store_id = ${tenant.storeId}`;
  expect(published!.s ?? []).toHaveLength(0);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("button", { name: "Volver a como estaba" }).click();
  await expect(page.getByText(/Cambios sin guardar|Guardando/)).toBeVisible();
  await expect(page.getByText(/Guardado en el borrador a las/)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await draft())!.map((s) => s.props.heading))
    .toEqual(["Mi portada de antes"]);
});
