import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/** F7-T06: Ajustes → Pagos y Notificaciones. */
const run = uniq();
const ownerEmail = `ajustes-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`s${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set contact_email = 'hola@ajustes.test' where id = ${tenant.storeId}`;
});

test("pagos y notificaciones de la tienda", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Pagos" }).click();
  await expect(page.getByRole("heading", { name: "Pagos", level: 1 })).toBeVisible();
  // Sin claves de Stripe en el entorno: el cobro con tarjeta no se ofrece.
  await expect(page.getByText("El cobro con tarjeta aún no está disponible")).toBeVisible();
  // Sin credenciales de Mercado Pago: se dice tal cual, sin botón de conectar (ADR-028).
  await expect(
    page.getByText("Aún no está disponible: faltan las credenciales de Mercado Pago"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar Mercado Pago" })).toHaveCount(0);
  await page.getByLabel("Instrucciones de pago").fill("Banco Ejemplo · CLABE 012345678901234567");
  await page.getByRole("button", { name: "Guardar pago" }).click();
  await expect(page.getByText("Pago por transferencia guardado.")).toBeVisible();
  // Un aviso de retorno con texto arbitrario no se refleja en la página.
  await page.goto(`/admin/${tenant.handle}/ajustes/pagos?stripe=<b>hola</b>`);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: "Notificaciones" }).click();
  const emails = page.getByLabel("Quién recibe los avisos de la tienda");
  await emails.fill("ventas@ajustes.test\nno-es-email");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "hasta 5 emails" })).toBeVisible();
  await expect(emails).toHaveValue("ventas@ajustes.test\nno-es-email");
  await emails.fill("Ventas@Ajustes.test\nbodega@ajustes.test");
  await page.getByLabel("un pedido quede pagado y listo para preparar").uncheck();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Notificaciones guardadas.")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [row] = await admin<{ staff_emails: string[]; notify_paid: boolean }[]>`
    select staff_emails, notify_paid from public.store_notification_settings where store_id = ${tenant.storeId}`;
  expect(row).toEqual({
    staff_emails: ["bodega@ajustes.test", "ventas@ajustes.test"],
    notify_paid: false,
  });
});
