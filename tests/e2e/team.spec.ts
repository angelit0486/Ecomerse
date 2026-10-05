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
  readInvitationLink,
  runJobs,
  uniq,
} from "./support";

/**
 * F2-T10: la dueña invita a un catalog_manager → acepta con 2FA → no ve Equipo y
 * las acciones forzadas devuelven 403; después la dueña cambia su rol, lo
 * suspende, restablece su 2FA y lo quita.
 */
const run = uniq();
const ownerEmail = `duena-t-${run}@example.test`;
const catEmail = `catalogo-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`m${run}`, ownerId);
});

test("invitación de punta a punta y permisos del catalog_manager", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await loginNewStaff(owner, ownerEmail);

  await owner.goto(`/admin/${tenant.handle}`);
  await owner
    .getByRole("navigation", { name: "Secciones de la tienda" })
    .getByRole("link", { name: "Equipo" })
    .click();
  await expect(owner.getByRole("heading", { name: "Equipo" })).toBeVisible();

  await owner.getByRole("button", { name: "Invitar a alguien" }).click();
  const dialog = owner.getByRole("dialog", { name: "Invitar a la tienda" });
  await dialog.getByLabel("Email").fill(catEmail);
  await dialog.getByRole("combobox", { name: "Rol" }).click();
  await owner.getByRole("option", { name: "Catálogo" }).click();
  await dialog.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(owner.getByText(`Invitación enviada a ${catEmail}.`).first()).toBeVisible();
  await expect(owner.getByRole("table", { name: "Invitaciones pendientes" })).toContainText(
    catEmail,
  );

  // El runner envía el email; el invitado acepta con su propio navegador.
  await runJobs();
  const link = await readInvitationLink(catEmail);
  const catContext = await browser.newContext();
  const cat = await catContext.newPage();
  await cat.goto(link);
  await expect(
    cat.getByRole("heading", { name: new RegExp(`Te invitaron a ${tenant.name}`) }),
  ).toBeVisible();
  const sentAt = Date.now() - 1000;
  await cat.getByRole("button", { name: "Enviarme un código" }).click();
  await enterEmailCode(cat, catEmail, sentAt);
  await enrollTotp(cat);
  await expect(cat).toHaveURL(/\/invitacion\/[0-9a-f]{64}$/);
  await cat.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(cat).toHaveURL(new RegExp(`/admin/${tenant.handle}$`));

  // Sin staff.read: no ve Equipo ni puede abrirlo por URL.
  await expect(
    cat
      .getByRole("navigation", { name: "Secciones de la tienda" })
      .getByRole("link", { name: "Equipo" }),
  ).toHaveCount(0);
  const forced = await cat.goto(`/admin/${tenant.handle}/ajustes/equipo`);
  expect(forced?.status()).toBe(404);

  // Acción forzada directamente contra la API con su sesión: 403.
  const token = await accessTokenFrom(catContext);
  const attempt = await fetch(`${API}/rest/v1/rpc/access_invite_member`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_organization_id: tenant.orgId,
      p_email: `intruso-${run}@example.test`,
      p_store_id: tenant.storeId,
      p_store_role_key: "store_admin",
    }),
  });
  expect(attempt.status).toBe(403);
  expect(((await attempt.json()) as { message: string }).message).toBe("forbidden");

  // La dueña gestiona al nuevo miembro.
  await owner.reload();
  const members = owner.getByRole("table", { name: "Miembros con acceso a la tienda" });
  const row = members.getByRole("row", { name: new RegExp(catEmail) });
  await expect(row).toBeVisible();

  await row.getByRole("combobox", { name: `Rol de ${catEmail}` }).click();
  await owner.getByRole("option", { name: "Solo lectura" }).click();
  await expect(owner.getByText("Rol actualizado.").first()).toBeVisible();

  await row.getByRole("button", { name: "Suspender" }).click();
  await expect(owner.getByText("Acceso suspendido.").first()).toBeVisible();
  await expect(row).toContainText("Suspendido");
  // Efecto inmediato: el miembro suspendido pierde el acceso a la tienda.
  expect((await cat.goto(`/admin/${tenant.handle}`))?.status()).toBe(404);

  await row.getByRole("button", { name: "Restablecer 2FA" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Restablecer" }).click();
  await expect(owner.getByText(/Verificación en dos pasos restablecida/).first()).toBeVisible();
  const [factors] = await admin<{ n: number }[]>`
    select count(*)::int as n from auth.mfa_factors f join auth.users u on u.id = f.user_id
     where u.email = ${catEmail}`;
  expect(factors!.n).toBe(0);

  await row.getByRole("button", { name: "Quitar" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Quitar de la tienda" }).click();
  await expect(owner.getByText("Miembro quitado de la tienda.").first()).toBeVisible();
  await expect(members.getByRole("row", { name: new RegExp(catEmail) })).toHaveCount(0);

  const audit = await admin<{ action: string }[]>`
    select action from audit.audit_logs where organization_id = ${tenant.orgId} order by occurred_at`;
  expect(audit.map((a) => a.action)).toEqual(
    expect.arrayContaining([
      "member.invited",
      "member.joined",
      "member.role_changed",
      "member.suspended",
      "member.mfa_reset",
      "member.removed",
    ]),
  );

  await ownerContext.close();
  await catContext.close();
});
