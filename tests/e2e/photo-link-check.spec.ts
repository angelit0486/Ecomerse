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
 * Revisar los enlaces de fotos antes de confirmar una importación (Orden 10,
 * O10-04). Los enlaces a direcciones internas se bloquean sin conectarse; uno
 * que no existe falla. Nada cambia en la tienda. (El caso «la foto funciona»
 * está en src/server/imports/photo-check.test.ts con un servidor real.)
 */
const run = uniq();
const ownerEmail = `fotoslink-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`fl${run}`, await createAuthUser(ownerEmail));
});

test("la vista previa revisa los enlaces y dice cuáles fallan y por qué", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  await page
    .getByLabel("Filas copiadas de tu hoja")
    .fill(
      [
        "Producto\tPrecio\tFotos",
        "Taza interna\t100\thttps://127.0.0.1/taza.jpg",
        "Plato metadatos\t100\thttps://169.254.169.254/latest/meta-data?token=secreto",
        "Jarra sin servidor\t100\thttps://fotos.invalid/jarra.jpg",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Validar filas" }).click();
  await expect(page.getByRole("heading", { name: "hoja-pegada.csv" })).toBeVisible();

  const section = page.getByRole("region", { name: "Revisar los enlaces de las fotos" });
  await section.getByRole("button", { name: "Revisar los enlaces" }).click();
  const status = section.getByRole("status");
  await expect(status).toContainText("0 de 3 enlaces funcionan.", { timeout: 30_000 });
  const problems = section
    .getByRole("list", { name: "Enlaces con problema" })
    .getByRole("listitem");
  await expect(problems).toHaveCount(3);
  await expect(problems.nth(0)).toContainText("Fila 2 · taza-interna");
  await expect(problems.nth(0)).toContainText("nada de direcciones internas");
  await expect(problems.nth(1)).toContainText("nada de direcciones internas");
  await expect(problems.nth(2)).toContainText("no respondió a tiempo");
  // El enlace se muestra sin su consulta.
  await expect(section.getByText("token=secreto")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  // Revisar no importa nada: la tienda sigue sin productos.
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.products where store_id = ${tenant.storeId}`;
  expect(row!.n).toBe(0);
});
