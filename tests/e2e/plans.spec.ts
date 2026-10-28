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
 * F10: vender la plataforma a un comercio sin SQL. La administración crea un
 * plan, lo asigna y registra el pago; la dueña ve su plan y su uso, y un pago
 * pendiente le avisa en el panel.
 */
const run = uniq();
const planKey = `plan_${run}`.replace(/[^a-z0-9_]/g, "").slice(0, 30);
const planName = `Crece ${run}`;

test.describe.configure({ mode: "serial" });

let tenant: Awaited<ReturnType<typeof createTenant>>;
const ownerEmail = `duena-plan-${run}@example.test`;

test.beforeAll(async () => {
  tenant = await createTenant(`pl${run}`, await createAuthUser(ownerEmail));
});

test("la plataforma crea un plan, lo asigna y registra el pago", async ({ page }) => {
  const email = `padmin-plan-${run}@platform.test`;
  await admin`insert into public.platform_staff (user_id, role)
              values (${await createAuthUser(email)}, 'platform_admin')`;
  await loginNewStaff(page, email);

  await page.goto("/platform/planes");
  const form = page.getByRole("region", { name: "Nuevo plan" });
  await form.getByLabel("Clave").fill(planKey);
  await form.getByLabel("Nombre").fill(planName);
  await form.getByLabel("Tiendas").fill("2");
  await form.getByLabel("Productos").fill("300");
  await form.getByLabel("Presentaciones por producto").fill("20");
  await form.getByLabel("Personas del equipo").fill("5");
  await form.getByLabel("Almacenes").fill("1");
  await form.getByLabel("Dominios propios").fill("1");
  // Falta el espacio para fotos: no se envía (un límite ausente valdría 0 y bloquearía).
  await form.getByRole("button", { name: "Crear plan" }).click();
  await expect(form.getByLabel("Espacio para fotos (MB)")).toBeFocused();
  await expect(form.getByRole("status")).toHaveCount(0);
  await form.getByLabel("Espacio para fotos (MB)").fill("2000");
  await form.getByLabel("Dominio propio").check();
  await form.getByRole("button", { name: "Crear plan" }).click();
  await expect(form.getByRole("status")).toHaveText("Plan guardado.");
  await expectNoSeriousA11yViolations(page);

  await page.goto(`/platform/organizaciones/${tenant.orgId}`);
  await page.getByLabel("Qué hacer").selectOption("change_plan");
  await page.getByRole("combobox", { name: "Plan", exact: true }).selectOption(planKey);
  await page.getByLabel("Motivo").first().fill("Contrató el plan Crece");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan cambiado." })).toBeVisible();

  await page.reload();
  await page.getByLabel("Qué hacer").selectOption("activate");
  await page.getByLabel("Días").fill("30");
  await page.getByLabel("Motivo").first().fill("Pagó noviembre por transferencia");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pago registrado: la suscripción está activa." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(planName).first()).toBeVisible();
  await expect(page.getByText("Pagado hasta")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("la dueña ve su plan y su uso, y el aviso de pago pendiente", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;
  await page.goto(`${base}/ajustes/plan`);
  await expect(page.getByRole("heading", { name: "Plan y uso" })).toBeVisible();
  await expect(page.getByText(planName)).toBeVisible();
  await expect(page.getByRole("meter", { name: "Tiendas: 1 de 2" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // La plataforma marca el pago pendiente: la dueña lo ve en todo el panel.
  await admin`update public.subscriptions
                 set status = 'past_due', grace_ends_at = now() + interval '5 days'
               where organization_id = ${tenant.orgId} and status <> 'cancelled'`;
  await page.goto(base);
  await expect(
    page.getByRole("status").filter({ hasText: "Tu pago está pendiente." }),
  ).toBeVisible();
});
