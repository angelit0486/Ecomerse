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
 * Si a la base le faltan migraciones, la tienda dice «Tienda en mantenimiento» y
 * la consola avisa, en vez de pantallas rotas. Se simula con una base «atrasada»
 * y se restaura siempre al terminar.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const staffEmail = `pversion-${run}@platform.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.beforeAll(async () => {
  const staffId = await createAuthUser(staffEmail);
  await admin`insert into public.platform_staff (user_id, role) values (${staffId}, 'platform_admin')`;
  tenant = await createTenant(`v${run}`, await createAuthUser(`duena-v-${run}@example.test`));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
});

test("tienda sin la función de versión (migración faltante): aviso de mantenimiento", async ({
  page,
}) => {
  await page.goto(`${origin()}/`);
  await expect(page.getByRole("heading", { name: "Tienda en mantenimiento" })).toHaveCount(0);
  await admin`alter function storefront.schema_version() rename to schema_version_e2e`;
  try {
    await page.goto(`${origin()}/`);
    await expect(page.getByRole("heading", { name: "Tienda en mantenimiento" })).toBeVisible();
    await expect(page).toHaveTitle("Tienda en mantenimiento");
    await expectNoSeriousA11yViolations(page);
  } finally {
    await admin`alter function storefront.schema_version_e2e() rename to schema_version`;
  }
  await page.goto(`${origin()}/`);
  await expect(page.getByRole("heading", { name: "Tienda en mantenimiento" })).toHaveCount(0);
});

test("consola con una base atrasada: aviso con la versión de la base", async ({ page }) => {
  await loginNewStaff(page, staffEmail);
  await page.goto("/platform");
  await expect(page.getByRole("alert").filter({ hasText: "Faltan migraciones" })).toHaveCount(0);
  const [row] = await admin<{ v: string }[]>`select public.app_schema_version() as v`;
  const v = row!.v;
  await admin.unsafe(`create or replace function public.app_schema_version() returns text language sql
                      immutable set search_path = '' as $$ select '20261001000000'::text $$`);
  try {
    await page.reload();
    await expect(
      page.getByRole("alert").filter({ hasText: "la base está en 20261001000000" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  } finally {
    await admin.unsafe(`create or replace function public.app_schema_version() returns text language sql
                        immutable set search_path = '' as $$ select '${v}'::text $$`);
  }
});
