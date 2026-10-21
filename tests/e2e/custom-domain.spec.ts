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
 * E16: dominio propio desde Ajustes → Dominio. La verificación real (DNS y
 * Vercel) la hace el worker; aquí se simula su resultado llamando a la función
 * del worker con el código que mostró el panel, como haría el job.
 */
const run = uniq();
const ownerEmail = `dominio-${run}@example.test`;
const hostname = `www.tienda${run}.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`d${run}`, await createAuthUser(ownerEmail));
});

test("agregar, ver el TXT, verificar, hacerlo principal y quitarlo", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/ajustes/dominio`);
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel("Tu dominio").fill("https://mia.tiendas.localhost/");
  await page.getByRole("button", { name: "Agregar dominio" }).click();
  await expect(page.getByText("Ese dominio es de la plataforma.")).toBeVisible();

  await page.getByLabel("Tu dominio").fill(`https://${hostname.toUpperCase()}/inicio`);
  await page.getByRole("button", { name: "Agregar dominio" }).click();
  const records = page.getByRole("table", { name: `Registros DNS para ${hostname}` });
  await expect(records.getByText(`_platform-verify.${hostname}`)).toBeVisible();
  const token = (await records.getByText(/^pruva-[0-9a-f]{32}$/).textContent())!;
  await expectNoSeriousA11yViolations(page);

  // El worker encuentra el TXT y el proveedor listo.
  const [domain] = await admin<{ id: string }[]>`
    select id from public.store_domains where hostname = ${hostname}`;
  await admin.begin(async (sql) => {
    await sql`set local role system_worker`;
    await sql`select system.domains_record_check(${domain!.id}, ${[token]}, 'ready', 'prj_e2e')`;
  });

  await page.reload();
  const card = page
    .locator("div")
    .filter({ hasText: hostname })
    .filter({
      has: page.getByRole("button", { name: "Usar como principal" }),
    });
  await expect(card.getByText("Activo").first()).toBeVisible();
  await card.getByRole("button", { name: "Usar como principal" }).click();
  await expect(page.getByRole("status")).toContainText("tu tienda abre con tu dominio");
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: hostname })
      .getByText(/principal · Activo/),
  ).toBeVisible();
  const [primary] = await admin<{ hostname: string }[]>`
    select hostname from public.store_domains where store_id = ${tenant.storeId} and is_primary`;
  expect(primary!.hostname).toBe(hostname);

  await page.reload();
  await page.getByRole("button", { name: `Quitar ${hostname}` }).click();
  await expect(page.getByRole("status")).toContainText("Dominio quitado.");
  const [back] = await admin<{ hostname: string }[]>`
    select hostname from public.store_domains where store_id = ${tenant.storeId} and is_primary`;
  expect(back!.hostname).toBe(`${tenant.handle}.localhost`);
});
