import { expect, test } from "@playwright/test";

import {
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * «Lanza tu tienda» (panel, 2026-11-26): el Inicio y la guía cuentan lo mismo,
 * la guía dice cuál es el siguiente paso y por qué, envíos no sale «Listo» sin
 * una zona real, y desde cualquier pantalla se vuelve a la guía.
 */
const run = uniq();
const ownerEmail = `guia-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`lg${run}`, await createAuthUser(ownerEmail));
});

test("Inicio y guía cuentan lo mismo; siguiente paso claro y volver a la guía", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  const card = page.getByText(/Le faltan? (\d+) pasos? necesarios? para publicar/);
  await expect(card).toBeVisible();
  const blocking = Number((await card.textContent())!.match(/Le faltan? (\d+)/)![1]);
  const nextText = (await page.getByText(/^Siguiente: /).textContent())!;
  const nextTitle = nextText.replace(/^Siguiente: /, "").replace(/\.$/, "");
  // En el Inicio no se ofrece «volver a la guía»: la tarjeta ya lleva a ella.
  await expect(page.getByRole("link", { name: "Volver a «Configura tu tienda»" })).toHaveCount(0);

  await page.getByRole("link", { name: "Terminar de configurar" }).click();
  await expect(page.getByRole("heading", { name: "Configura tu tienda" })).toBeVisible();
  const next = page.getByRole("region").filter({ hasText: "Siguiente paso" });
  await expect(next.getByRole("heading", { level: 2 })).toHaveText(nextTitle);
  const steps = page.getByRole("list", { name: "Pasos de configuración" });
  // Los «Necesario» pendientes de la guía (sin «Publicar») son los del Inicio.
  await expect(
    steps
      .getByRole("link")
      .filter({ hasText: "Necesario" })
      .filter({ hasNotText: /^\d*Publicar/ }),
  ).toHaveCount(blocking);
  await expect(steps.locator("[aria-current=step]")).toContainText(nextTitle);
  // Sin zonas de envío, «Envíos» no puede salir como listo.
  await expect(steps.getByRole("link", { name: /Envíos/ })).not.toContainText("Listo");
  await expectNoSeriousA11yViolations(page);

  // Desde Envíos se vuelve a la guía en un clic.
  await steps.getByRole("link", { name: /Envíos/ }).click();
  await page.getByRole("link", { name: "Volver a «Configura tu tienda»" }).click();
  await expect(page.getByRole("heading", { name: "Configura tu tienda" })).toBeVisible();
});
