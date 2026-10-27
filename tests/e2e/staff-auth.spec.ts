import { expect, test, type Page } from "@playwright/test";

import { totp } from "../support/totp";

import {
  admin,
  createAuthUser,
  createTenant,
  emailCount,
  readEmailCode,
  uniq,
  asFreshClient,
} from "./support";

/**
 * F2-T07: acceso del staff con código por email → TOTP obligatorio → AAL2.
 * Sin TOTP no se entra al panel; los eventos de seguridad quedan registrados.
 */
const run = uniq();
const ownerEmail = `duena-${run}@example.test`;
let ownerId: string;
let storeName: string;
let totpSecret: string;

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  storeName = (await createTenant(`e${run}`, ownerId)).name;
});

async function loginWithEmailCode(page: Page, email: string) {
  const sentAt = Date.now() - 1000;
  await asFreshClient(page);
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/ingresar\/codigo$/);
  await page.getByLabel("Código").fill(await readEmailCode(email, sentAt));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/seguridad\/2fa$/);
}

/** Código TOTP de una ventana que no se haya usado todavía. */
async function freshTotp(secret: string, used: Set<string>): Promise<string> {
  for (;;) {
    const code = totp(secret);
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
const usedCodes = new Set<string>();

test("primer acceso: código por email, activación de TOTP y panel", async ({ page }) => {
  await loginWithEmailCode(page, ownerEmail);

  // Sin TOTP, el panel redirige a la verificación en dos pasos.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/seguridad\/2fa$/);

  await page.getByRole("button", { name: "Activar verificación en dos pasos" }).click();
  totpSecret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await expect(page.getByAltText("Código QR para tu app de autenticación")).toBeVisible();

  await page.getByLabel("Código de la app").fill("000000");
  await page.getByRole("button", { name: "Activar y entrar" }).click();
  await expect(page.getByText("El código no es correcto")).toBeVisible();

  await page.getByLabel("Código de la app").fill(await freshTotp(totpSecret, usedCodes));
  await page.getByRole("button", { name: "Activar y entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Tus tiendas" })).toBeVisible();
  await expect(page.getByText(storeName)).toBeVisible();

  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/ingresar$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/ingresar$/);
});

test("siguientes accesos: piden el código de la app, sin volver a enrolar", async ({ page }) => {
  await loginWithEmailCode(page, ownerEmail);
  await expect(page.getByRole("button", { name: "Activar verificación en dos pasos" })).toHaveCount(
    0,
  );
  await page.getByLabel("Código de la app").fill(await freshTotp(totpSecret, usedCodes));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(storeName)).toBeVisible();
});

test("código incorrecto: mensaje de error, sin sesión", async ({ page }) => {
  const sentAt = Date.now() - 1000;
  await asFreshClient(page);
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await readEmailCode(ownerEmail, sentAt);
  await page.getByLabel("Código").fill("123456");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("El código no es correcto o caducó")).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/ingresar$/);
});

test("email sin cuenta: misma respuesta y ningún correo (sin autorregistro)", async ({ page }) => {
  const stranger = `nadie-${run}@example.test`;
  await asFreshClient(page);
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(stranger);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/ingresar\/codigo$/);
  await page.waitForTimeout(1500);
  expect(await emailCount(stranger)).toBe(0);
});

test("eventos de seguridad registrados sin PII", async () => {
  const events = await admin<{ type: string; metadata: unknown }[]>`
    select type, metadata from audit.security_events where user_id = ${ownerId} order by occurred_at`;
  const types = events.map((e) => e.type);
  expect(types).toEqual(
    expect.arrayContaining([
      "auth.login_succeeded",
      "auth.mfa_enrolled",
      "auth.mfa_failed",
      "auth.mfa_verified",
      "auth.logout",
    ]),
  );
  expect(JSON.stringify(events)).not.toContain(ownerEmail);
});

test("pedir códigos sin parar se frena con un límite propio (auditoría SEC-01)", async ({
  page,
}) => {
  const target = `limite-${run}@example.test`;
  await asFreshClient(page);
  // 10 intentos por email cada 15 minutos: el 11.º ya no envía nada.
  for (let i = 0; i < 10; i++) {
    await page.goto("/ingresar");
    await page.getByLabel("Email").fill(target);
    await page.getByRole("button", { name: "Enviarme un código" }).click();
    await expect(page).toHaveURL(/\/ingresar\/codigo$/);
  }
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(target);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page.getByText("Demasiados intentos. Espera unos minutos.")).toBeVisible();
  await expect(page).toHaveURL(/\/ingresar$/);
});
