import { expect, test } from "@playwright/test";

import {
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/** F8-T05: un cambio del panel aparece en Ajustes → Actividad con su autor. */
const run = uniq();
const ownerEmail = `actividad-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`ac${run}`, await createAuthUser(ownerEmail));
});

test("actividad: el cambio de impuestos queda registrado y se filtra por área", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/impuestos`);
  await page.getByLabel("Tasa de impuesto (%)").fill("16");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Impuestos guardados.")).toBeVisible();

  await page.getByRole("link", { name: "Actividad" }).click();
  await expect(page.getByRole("heading", { name: "Actividad" })).toBeVisible();
  await expect(page.getByText("Cambió los impuestos")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("link", { name: "Clientes", exact: true }).last().click();
  await expect(page.getByText("Sin actividad")).toBeVisible();
});
