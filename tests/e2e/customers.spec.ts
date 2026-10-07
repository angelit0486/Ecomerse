import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/** F8-T02: clientes en el panel (búsqueda, edición, retiro de consentimiento, anonimizar). */
const run = uniq();
const ownerEmail = `clientes-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let customerId: string;

test.beforeAll(async () => {
  tenant = await createTenant(`cl${run}`, await createAuthUser(ownerEmail));
  const [c] = await admin<{ id: string }[]>`
    insert into public.customers (store_id, email, first_name, last_name, phone, accepts_marketing,
                                  marketing_consent_at, marketing_consent_source)
    values (${tenant.storeId}, ${`luisa-${run}@compra.test`}, 'Luisa', 'Pérez', '+52 81 5555 1234', true, now(), 'checkout')
    returning id`;
  customerId = c!.id;
  await admin`insert into public.customer_addresses (store_id, customer_id, recipient_name, line1, city, region,
                                                     postal_code, country, is_default)
              values (${tenant.storeId}, ${customerId}, 'Luisa Pérez', 'Calle Roble 12', 'Monterrey', 'NL', '64000', 'MX', true)`;
  await admin`insert into public.customers (store_id, email) values (${tenant.storeId}, ${`otro-${run}@compra.test`})`;
});

test("clientes: buscar, editar, retirar consentimiento y anonimizar", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Clientes" }).click();
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await page.getByLabel("Buscar por email o nombre").fill("luisa");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByRole("link", { name: "Luisa Pérez" })).toBeVisible();
  await expect(page.getByText(`otro-${run}@compra.test`)).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: "Luisa Pérez" }).click();
  await expect(page.getByText("Calle Roble 12")).toBeVisible();
  await page
    .getByLabel("Nota interna (el cliente no la ve)")
    .fill("Prefiere entregas por la tarde");
  await page.getByLabel(/Acepta recibir publicidad/).uncheck();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Cliente actualizado.")).toBeVisible();
  const [after] = await admin<{ note: string; accepts_marketing: boolean }[]>`
    select note, accepts_marketing from public.customers where id = ${customerId}`;
  expect(after).toEqual({ note: "Prefiere entregas por la tarde", accepts_marketing: false });

  await page.getByLabel("Motivo").fill("La clienta pidió eliminar sus datos");
  await page.getByRole("button", { name: "Eliminar datos personales" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "no se puede deshacer" })).toBeVisible();
  await page.getByLabel("Entiendo que no se puede deshacer").check();
  await page.getByRole("button", { name: "Eliminar datos personales" }).click();
  await expect(page.getByRole("heading", { name: "Cliente anonimizado" })).toBeVisible();
  await expect(page.getByText("Calle Roble 12")).toHaveCount(0);
  const [anon] = await admin<{ email: string; first_name: string | null }[]>`
    select email, first_name from public.customers where id = ${customerId}`;
  expect(anon!.first_name).toBeNull();
  expect(anon!.email).toMatch(/^anonimo-.*@anonimizado\.invalid$/);
});
