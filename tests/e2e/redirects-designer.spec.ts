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
 * Paso 4 del estudio: redirecciones 301 (D-EST-02) desde Contenido, aplicadas por
 * la tienda, y el rol Diseño (D-EST-01): apariencia y contenido sí, pedidos no.
 */
const run = uniq();
const designerEmail = `diseno-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.beforeAll(async () => {
  tenant = await createTenant(`r${run}`, await createAuthUser(`duena-r-${run}@example.test`));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  const designerId = await createAuthUser(designerEmail);
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${tenant.orgId}, ${designerId}, 'org_member')`;
  await admin`insert into public.store_members (store_id, user_id, role_id)
              select ${tenant.storeId}, ${designerId}, r.id from public.roles r
               where r.key = 'designer' and r.organization_id is null`;
});

test("Diseño crea una redirección 301 y no ve pedidos", async ({ page, request }) => {
  await loginNewStaff(page, designerEmail);
  await page.goto(`/admin/${tenant.handle}/contenido`);
  await page.getByRole("link", { name: "Redirecciones de direcciones viejas" }).click();
  await expect(page.getByRole("heading", { name: "Redirecciones" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // A otro sitio no: sin redirección abierta.
  await page.getByLabel("Dirección vieja").fill("/promo");
  await page.getByLabel("Llevar a").fill("https://otro-sitio.example/x");
  await page.getByRole("button", { name: "Guardar redirección" }).click();
  await expect(page.getByText("Escribe una dirección de tu tienda").first()).toBeVisible();

  await page.getByLabel("Dirección vieja").fill(`${origin()}/Productos/Proteina-2024`);
  await page.getByLabel("Llevar a").fill("/productos");
  await page.getByRole("button", { name: "Guardar redirección" }).click();
  await expect(page.getByText("Redirección guardada.")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "/productos/proteina-2024", exact: true }),
  ).toBeVisible();

  // La API de pruebas no resuelve *.localhost: misma petición con el Host de la tienda.
  const res = await request.get("http://localhost:3000/productos/proteina-2024?utm=x", {
    headers: { host: `${tenant.handle}.localhost:3000` },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(301);
  expect(new URL(res.headers()["location"]!, origin()).pathname).toBe("/productos");
  expect(new URL(res.headers()["location"]!, origin()).search).toBe("?utm=x");

  await page.getByRole("button", { name: "Quitar /productos/proteina-2024" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Redirección quitada." })).toBeVisible();

  // Rol Diseño: apariencia sí; pedidos, no.
  const design = await page.goto(`/admin/${tenant.handle}/apariencia`);
  expect(design?.status()).toBe(200);
  const orders = await page.goto(`/admin/${tenant.handle}/pedidos`);
  expect(orders?.status()).toBe(404);
});
