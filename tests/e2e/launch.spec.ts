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
 * F7-T05: la tienda se publica solo con el checklist completo (§14.3). El pago
 * manual se configura en el paso 3; las políticas deben dejar de ser plantilla.
 */
const run = uniq();
const ownerEmail = `lanza-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`p${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set contact_email = 'hola@lanza.test' where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Libreta', 'libreta', 'active', now()) returning id`;
  await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
              values (${tenant.storeId}, ${p!.id}, ${`LIB-${run}`}, 15000, '', false)`;
  // La plantilla publicada sin completar NO cuenta: se completa con texto propio.
  await admin`update public.store_pages set is_published = true, published_at = now()
               where store_id = ${tenant.storeId} and type in ('policy_privacy', 'policy_terms', 'policy_returns')`;
});

test("lanzamiento: pendientes visibles → pago manual → políticas → publicada", async ({
  page,
  browser,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/configuracion`);
  const pending = page.getByRole("list", { name: "Pendientes para publicar" });
  await expect(pending.getByRole("listitem")).toHaveCount(4);
  await expect(pending.getByText("Publica tu aviso de privacidad")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publicar tienda" })).toBeDisabled();

  // Paso 3: pago por transferencia.
  await page.getByLabel("Instrucciones de pago").fill("corto");
  await page.getByRole("button", { name: "Guardar pago" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Escribe instrucciones" })).toBeVisible();
  await page
    .getByLabel("Instrucciones de pago")
    .fill("Banco Ejemplo · CLABE 012345678901234567 · Titular: Lanza SA");
  await page.getByRole("button", { name: "Guardar pago" }).click();
  await expect(page.getByText("Pago por transferencia guardado.")).toBeVisible();
  await expect(pending.getByRole("listitem")).toHaveCount(3);
  await expectNoSeriousA11yViolations(page);

  // Marca elegida en el asistente: sale publicada con la tienda (auditoría, fallo 1).
  await page.getByLabel("Texto", { exact: true }).fill("#0b1320");
  await page.getByLabel("Color principal (botones y enlaces)").fill("#0f766e");
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(page.getByText("Guardado en el borrador.", { exact: false })).toBeVisible();
  await expect(page.getByText(/de 4 pasos listos/)).toBeVisible();

  // Políticas con contenido propio (el comerciante las redacta; aquí, el test).
  await admin`update public.store_pages set body_html = '<p>Texto propio de la tienda.</p>'
               where store_id = ${tenant.storeId} and type in ('policy_privacy', 'policy_terms', 'policy_returns')`;
  await page.reload();
  await expect(page.getByText("Todo listo para publicar.")).toBeVisible();
  await page.getByRole("button", { name: "Publicar tienda" }).click();
  await expect(page.getByText("Tu tienda está publicada")).toBeVisible();

  const [store] = await admin<{ status: string; launched: boolean }[]>`
    select status, launched_at is not null as launched from public.stores where id = ${tenant.storeId}`;
  expect(store).toEqual({ status: "active", launched: true });
  const [theme] = await admin<{ primary: string | null; draft: unknown }[]>`
    select settings #>> '{colors,primary}' as primary, draft_settings as draft
      from public.store_themes where store_id = ${tenant.storeId}`;
  expect(theme).toEqual({ primary: "#0f766e", draft: null });
  const anonymous = await browser.newPage();
  const response = await anonymous.goto(`http://${tenant.handle}.localhost:3000/`);
  expect(response?.status()).toBe(200);
  await anonymous.close();
});
