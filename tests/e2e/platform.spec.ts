import { expect, test } from "@playwright/test";

import {
  accessTokenFrom,
  admin,
  API,
  createAuthUser,
  createTenant,
  enrollTotp,
  enterEmailCode,
  loginNewStaff,
  MAIL,
  readInvitationLink,
  runJobs,
  uniq,
} from "./support";

/**
 * F2-T12: consola de plataforma mínima. platform_admin crea tenants, suspende y
 * concede soporte con motivo; platform_support solo lee y no puede crear
 * tenants; un tenant no ve la consola.
 */
const run = uniq();
const adminEmail = `padmin-${run}@platform.test`;
const supportEmail = `psoporte-${run}@platform.test`;
const ownerEmail = `duena-p-${run}@example.test`;
const newOwnerEmail = `nuevo-dueno-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const adminId = await createAuthUser(adminEmail);
  const supportId = await createAuthUser(supportEmail);
  await admin`insert into public.platform_staff (user_id, role)
              values (${adminId}, 'platform_admin'), (${supportId}, 'platform_support')`;
  tenant = await createTenant(`p${run}`, await createAuthUser(ownerEmail));
});

test("platform_admin: crea un tenant, suspende y concede soporte con motivo", async ({
  page,
  browser,
}) => {
  await loginNewStaff(page, adminEmail);
  await page.getByRole("link", { name: "Ir a la consola de plataforma" }).click();
  await expect(page.getByRole("heading", { name: "Organizaciones" })).toBeVisible();

  // Pulido (D-2): en el celular la consola cabe en 375 px y sus enlaces miden 44 px.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const consoleNav = page.getByRole("navigation", { name: "Consola de plataforma" });
  for (const name of ["Organizaciones", "Soporte", "Cumplimiento"]) {
    const box = (await consoleNav.getByRole("link", { name }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
  const create = page.getByRole("link", { name: "Crear organización y tienda" });
  expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize(viewport);

  // Alta asistida → invitación al dueño.
  await page.getByRole("link", { name: "Crear organización y tienda" }).click();
  await page.getByLabel("Nombre de la organización").fill(`Nueva ${run}`);
  await page.getByLabel("Slug de la organización").fill(`nueva-${run}`);
  await page.getByLabel("Email del dueño").fill(newOwnerEmail);
  await page.getByLabel("Nombre de la tienda").fill(`Tienda Nueva ${run}`);
  await page.getByLabel("Dirección de la tienda (handle)").fill(`nueva-${run}`);
  await page.getByRole("combobox", { name: "Plan" }).selectOption({ label: "e2e_plan" });
  await page.getByRole("button", { name: "Crear organización y tienda" }).click();
  await expect(page.getByText(`Tienda creada en nueva-${run}.tiendas.localhost.`)).toBeVisible();
  await runJobs();
  const invitation = await readInvitationLink(newOwnerEmail);
  expect(invitation).toMatch(/\/invitacion\/[0-9a-f]{64}$/);

  // El dueño acepta: cuenta nueva por invitación → 2FA → su tienda en borrador.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto(invitation);
  const sentAt = Date.now() - 1000;
  await owner.getByRole("button", { name: "Enviarme un código" }).click();
  await enterEmailCode(owner, newOwnerEmail, sentAt);
  await enrollTotp(owner);
  await owner.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(owner).toHaveURL(new RegExp(`/admin/nueva-${run}$`));
  await expect(owner.getByText("Dueño de la organización")).toBeVisible();
  await expect(owner.getByRole("link", { name: "Configurar tienda" })).toBeVisible();
  await ownerContext.close();

  // Suspender y reactivar con motivo.
  await page.goto(`/platform?q=org-p${run}`);
  const row = page.getByRole("row", { name: new RegExp(`Org P${run}`, "i") });
  await row.getByRole("button", { name: "Suspender" }).click();
  await page.getByRole("dialog").getByLabel("Motivo").fill("Contracargos reportados por el banco");
  await page.getByRole("dialog").getByRole("button", { name: "Suspender" }).click();
  await expect(page.getByRole("dialog").getByText("Organización suspendida.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(row).toContainText("Suspendida");
  await row.getByRole("button", { name: "Reactivar" }).click();
  await page.getByRole("dialog").getByLabel("Motivo").fill("Aclaración recibida y verificada");
  await page.getByRole("dialog").getByRole("button", { name: "Reactivar" }).click();
  await expect(page.getByRole("dialog").getByText("Organización reactivada.")).toBeVisible();

  // Concesión de soporte con motivo → aviso al dueño.
  await page.goto("/platform/soporte");
  await page.getByLabel("Buscar tienda u organización").fill(tenant.name);
  await page.getByLabel("Buscar tienda u organización").press("Enter");
  await expect(page).toHaveURL(/tienda=/);
  const storeSelect = page.getByRole("combobox", { name: "Tienda", exact: true });
  const storeLabel = await storeSelect
    .locator("option", { hasText: tenant.name })
    .first()
    .textContent();
  await storeSelect.selectOption({ label: storeLabel! });
  await page
    .getByRole("combobox", { name: "Persona de soporte" })
    .selectOption({ label: supportEmail });
  await page.getByLabel("Motivo").fill("Ticket 42: la dueña no ve sus pedidos del día");
  await page.getByRole("button", { name: "Conceder acceso de solo lectura" }).click();
  await expect(page.getByText("Acceso concedido. Avisamos al dueño de la tienda.")).toBeVisible();
  await expect(page.getByRole("table", { name: /Accesos vigentes/ })).toContainText(supportEmail);

  await runJobs();
  let notice = 0;
  for (let i = 0; i < 40 && notice === 0; i += 1) {
    const res = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${ownerEmail}`)}`,
    );
    notice = ((await res.json()) as { messages: { Subject: string }[] }).messages.filter((m) =>
      m.Subject.startsWith("Acceso de soporte"),
    ).length;
    if (notice === 0) await new Promise((r) => setTimeout(r, 250));
  }
  expect(notice).toBe(1);
});

test("platform_support: solo lectura, sin crear tenants; entra a la tienda concedida", async ({
  page,
  context,
}) => {
  await loginNewStaff(page, supportEmail);
  await page.goto("/platform");
  await expect(page.getByRole("heading", { name: "Organizaciones" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Crear organización y tienda" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suspender" })).toHaveCount(0);
  expect((await page.goto("/platform/organizaciones/nueva"))?.status()).toBe(404);

  // Acción forzada contra la API: 403.
  const token = await accessTokenFrom(context);
  const forced = await fetch(`${API}/rest/v1/rpc/platform_create_organization_with_store`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_org_name: "X",
      p_org_slug: `x-${run}`,
      p_org_country: "MX",
      p_owner_email: "x@example.test",
      p_store_name: "X",
      p_store_handle: `x-${run}`,
      p_plan_key: "e2e_plan",
    }),
  });
  expect(forced.status).toBe(403);

  // Con la concesión: la tienda en modo soporte, auditado.
  await page.goto(`/admin/${tenant.handle}`);
  await expect(page.getByText(/Acceso de soporte: solo lectura/)).toBeVisible();
  const [views] = await admin<{ n: number }[]>`
    select count(*)::int as n from audit.audit_logs
     where action = 'support_session.page_viewed' and store_id = ${tenant.storeId}`;
  expect(views!.n).toBeGreaterThan(0);
});

test("un tenant no ve la consola", async ({ page }) => {
  const email = `tenant-${run}@example.test`;
  await createTenant(`q${run}`, await createAuthUser(email));
  await loginNewStaff(page, email);
  await expect(page.getByRole("link", { name: "Ir a la consola de plataforma" })).toHaveCount(0);
  expect((await page.goto("/platform"))?.status()).toBe(404);
});
