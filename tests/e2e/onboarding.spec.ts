import { expect, test } from "@playwright/test";

import { admin, createAuthUser, createTenant, loginNewStaff, uniq } from "./support";

/**
 * F2-T11 + F7-T05: onboarding en 4 pasos. El contraste insuficiente bloquea guardar;
 * sin pagos ni políticas la tienda queda en borrador, visible con la vista previa firmada.
 */
const run = uniq();
const ownerEmail = `duena-o-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`o${run}`, await createAuthUser(ownerEmail));
});

test("onboarding: datos, marca con contraste, pagos pendientes y vista previa", async ({
  page,
  context,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  // Inicio: la tienda en borrador lo dice arriba y lleva a terminarla (misión panel, F3).
  await expect(page.getByText("Tu tienda aún no está publicada.")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Acciones rápidas" }).getByRole("link", {
      name: "Agregar producto",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Terminar de configurar" }).click();
  await expect(page.getByRole("heading", { name: "Configura tu tienda" })).toBeVisible();

  // Paso 2a: datos de la tienda (con validación del servidor).
  await page.getByLabel("Email de contacto").fill("no-es-email");
  await page.getByRole("button", { name: "Guardar datos" }).click();
  await expect(page.getByText("Escribe un email válido.")).toBeVisible();
  // Lo escrito no se pierde tras el error (revisión de código del gate).
  await expect(page.getByLabel("Email de contacto")).toHaveValue("no-es-email");

  await page.getByLabel("Nombre de la tienda").fill(`Moda Ana ${run}`);
  await page.getByLabel("Email de contacto").fill("Hola@ModaAna.mx");
  await page.getByLabel("Teléfono").fill("+52 55 1234 5678");
  await page.getByRole("combobox", { name: "Zona horaria" }).click();
  // La Paz, BCS (la tienda del propietario) está en la zona del Pacífico.
  await page
    .getByRole("option", { name: "Pacífico (Baja California Sur, Sinaloa, Nayarit)" })
    .click();
  await page.getByRole("button", { name: "Guardar datos" }).click();
  await expect(page.getByText("Datos de la tienda guardados.")).toBeVisible();
  const [tz] = await admin<{ timezone: string }[]>`
    select timezone from public.stores where handle = ${tenant.handle}`;
  expect(tz!.timezone).toBe("America/Mazatlan");

  // Paso 2b: el contraste insuficiente bloquea guardar.
  const save = page.getByRole("button", { name: "Guardar en el borrador" });
  await page.getByLabel("Texto", { exact: true }).fill("#cccccc");
  await expect(page.getByText("El texto no se lee bien sobre el fondo")).toBeVisible();
  await expect(save).toBeDisabled();

  await page.getByLabel("Texto", { exact: true }).fill("#0b1320");
  await page.getByLabel("Color principal (botones y enlaces)").fill("#0f766e");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Guardado en el borrador.", { exact: false })).toBeVisible();

  // Pasos 3 y 4 (F7-T05): sin pagos ni políticas la tienda no se publica; queda en
  // borrador con vista previa.
  const pending = page.getByRole("list", { name: "Pendientes para publicar" });
  await expect(pending.getByText("Activa al menos un método de pago real")).toBeVisible();
  await expect(pending.getByText("Publica tu aviso de privacidad")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publicar tienda" })).toBeDisabled();
  const [preview] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Ver vista previa de la tienda" }).click(),
  ]);
  await preview.waitForLoadState();
  await expect(preview.getByText("Vista previa: solo tú puedes ver esta tienda.")).toBeVisible();
  await expect(preview.getByRole("heading", { name: `Moda Ana ${run}` })).toBeVisible();

  const [store] = await admin<{ status: string; contact_email: string; draft: unknown }[]>`
    select s.status, s.contact_email, t.draft_settings as draft
      from public.stores s join public.store_themes t on t.store_id = s.id
     where s.id = ${tenant.storeId}`;
  expect(store).toMatchObject({ status: "draft", contact_email: "hola@modaana.mx" });
  expect(store!.draft).toMatchObject({ colors: { foreground: "#0b1320", primary: "#0f766e" } });

  // Sin la cookie de vista previa, el borrador no es visible para nadie.
  const anonymous = await context.browser()!.newPage();
  const response = await anonymous.goto(`http://${tenant.handle}.localhost:3000/`);
  expect(response?.status()).toBe(404);
  await anonymous.close();
});
