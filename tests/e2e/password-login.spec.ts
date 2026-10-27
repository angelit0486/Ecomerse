import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  freshTotp,
  loginNewStaff,
  uniq,
  asFreshClient,
} from "./support";

/**
 * ADR-031: contraseña como alternativa al código por email. Se crea solo con la
 * sesión completa (AAL2) y entrar con ella sigue pidiendo el código de la app.
 */
const run = uniq();
const email = `contrasena-${run}@example.test`;
const password = `Frase-Larga-${run}-9!`;

test.beforeAll(async () => {
  const ownerId = await createAuthUser(email);
  await createTenant(`pw${run}`, ownerId);
});

test("crear la contraseña y entrar con ella más el código de la app", async ({ page }) => {
  const secret = await loginNewStaff(page, email);

  await page.getByRole("link", { name: "Contraseña" }).click();
  await expect(page).toHaveURL(/\/seguridad\/contrasena$/);
  await page.getByLabel("Contraseña nueva").fill("corta");
  await page.getByLabel("Repite la contraseña").fill("corta");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "al menos 12 caracteres" })).toBeVisible();
  await page.getByLabel("Contraseña nueva").fill(password);
  await page.getByLabel("Repite la contraseña").fill(`${password}x`);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "no coinciden" })).toBeVisible();
  await page.getByLabel("Contraseña nueva").fill(password);
  await page.getByLabel("Repite la contraseña").fill(password);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Contraseña guardada" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [event] = await admin<{ n: number }[]>`
    select count(*)::int as n from audit.security_events e
      join auth.users u on u.id = e.user_id
     where u.email = ${email} and e.type = 'auth.password_set'`;
  expect(event!.n).toBe(1);

  // Salir y volver a entrar con la contraseña.
  await page.goto("/admin");
  await page.getByRole("button", { name: "Salir" }).click();
  await asFreshClient(page);
  await page.goto("/ingresar");
  await page.getByRole("link", { name: "Entrar con contraseña" }).click();
  await expect(page).toHaveURL(/\/ingresar\/contrasena$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill("no es la contraseña");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "no son correctos" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Sin el código de la app no hay panel.
  await expect(page).toHaveURL(/\/seguridad\/2fa$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/seguridad\/2fa$/);
  await page.getByLabel("Código de la app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("un email sin cuenta recibe el mismo mensaje que una contraseña incorrecta", async ({
  page,
}) => {
  await asFreshClient(page);
  await page.goto("/ingresar/contrasena");
  await page.getByLabel("Email").fill(`nadie-${run}@example.test`);
  await page.getByLabel("Contraseña").fill("cualquier cosa larga");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "El email o la contraseña no son correctos." }),
  ).toBeVisible();
});
