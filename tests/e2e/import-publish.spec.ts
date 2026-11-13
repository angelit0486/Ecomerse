import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  runJobs,
  uniq,
} from "./support";

/**
 * Publicación masiva por candidatos (Orden 10, mensaje 4): «Publicado: sí» en la
 * hoja pide publicar; después de importar, el worker publica los que cumplen y
 * la página resume cuántos se publicaron y por qué quedaron pendientes los demás.
 */
const run = uniq();
const ownerEmail = `publicar-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`pb${run}`, await createAuthUser(ownerEmail));
});

const statusOf = async (title: string) => {
  const [row] = await admin<{ status: string }[]>`
    select status from public.products where store_id = ${tenant.storeId} and title = ${title}`;
  return row?.status;
};

test("«Publicado: sí» publica los que cumplen y explica los pendientes", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  await page
    .getByLabel("Filas copiadas de tu hoja")
    .fill(
      [
        "Producto\tPrecio\tPublicado",
        "Taza de barro\t150\tsí",
        "Plato hondo\t0\tsí",
        "Vaso alto\t90\tno",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Validar filas" }).click();
  await expect(page.getByRole("heading", { name: "hoja-pegada.csv" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importación" }).click();

  // La importación y después la publicación por tandas (como el cron).
  await expect(async () => {
    await runJobs();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Publicación" }).getByRole("status"),
    ).toContainText("1 publicado.", { timeout: 3_000 });
  }).toPass({ timeout: 90_000 });

  const summary = page.getByRole("region", { name: "Publicación" });
  await expect(summary.getByRole("status")).toContainText("1 pendiente: 1 con precio inválido.");
  const pending = summary
    .getByRole("list", { name: "Productos sin publicar" })
    .getByRole("listitem");
  await expect(pending.filter({ hasText: "Plato hondo" }).first()).toContainText("precio 0");
  await expectNoSeriousA11yViolations(page);

  // Nada se publicó saltándose las reglas.
  expect(await statusOf("Taza de barro")).toBe("active");
  expect(await statusOf("Plato hondo")).toBe("draft");
  expect(await statusOf("Vaso alto")).toBe("draft");
});
