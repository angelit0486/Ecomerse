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
 * Misión Panel, Paso C: Portada → Colores, aparte de Diseño. Una paleta con un
 * toque, colores propios del pie y de un bloque, aviso de contraste con color
 * sugerido; guardar colores no cambia el orden ni el contenido de los bloques.
 */
const run = uniq();
const ownerEmail = `colores-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const store = () => `http://${tenant.handle}.localhost:3000`;
const SECTIONS = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    type: "hero",
    enabled: true,
    props: { heading: "Suplementos originales", align: "left" },
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    type: "faq",
    enabled: true,
    props: { title: "Preguntas", items: [{ question: "¿Envían?", answer: "Sí, a todo México." }] },
  },
];

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`tc${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.appearance_save_home_draft(${tenant.storeId}, ${sql.json(SECTIONS)}, 0)`;
    await sql`select public.appearance_publish_theme(${tenant.storeId}, 1)`;
  });
});

test("colores aparte del diseño, con contraste revisado", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);
  await page.getByRole("link", { name: "Colores" }).click();
  await expect(page.getByRole("link", { name: "Colores" })).toHaveAttribute("aria-current", "page");

  // Paleta con un toque.
  await page.getByRole("button", { name: "PRUVA" }).click();
  await expect(page.getByLabel("Principal (botones)")).toHaveValue("#0b2d5b");

  // Pie con un texto ilegible: aviso, guardar bloqueado y color sugerido.
  await page.getByLabel(/Pie de página: colores propios/).check();
  await page.getByLabel("Fondo de pie de página").fill("#111827");
  await page.getByLabel("Texto de pie de página").fill("#374151");
  await expect(page.getByText("No se lee sobre su fondo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar colores en el borrador" })).toBeDisabled();
  await page.getByRole("button", { name: /Usar sugerido/ }).click();
  await expect(page.getByText("No se lee sobre su fondo.")).toHaveCount(0);

  // Colores propios de un bloque.
  await page.getByLabel(/Preguntas frecuentes «Preguntas»: fondo propio/).check();
  await page.getByLabel(/Fondo de Preguntas frecuentes/).fill("#0b2d5b");
  await page.getByLabel(/Texto de Preguntas frecuentes/).fill("#ffffff");
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Guardar colores en el borrador" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Colores guardados" })).toBeVisible();

  const [row] = await admin<
    { s: { colors?: unknown; props: unknown; id: string }[]; e: unknown }[]
  >`
    select draft_home_sections as s, draft_settings -> 'element_colors' as e
      from public.store_themes where store_id = ${tenant.storeId}`;
  expect(row!.s.map((x) => x.id)).toEqual(SECTIONS.map((x) => x.id));
  expect(row!.s.map((x) => x.props)).toEqual(SECTIONS.map((x) => x.props));
  expect(row!.s[1]!.colors).toEqual({ background: "#0b2d5b", foreground: "#ffffff" });
  expect(row!.s[0]!.colors).toBeUndefined();
  expect(row!.e).toMatchObject({ footer: { background: "#111827" } });

  // Publicar: la tienda pinta el bloque y el pie con sus colores.
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByRole("button", { name: "Sí, publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();
  await page.goto(store());
  const block = page.locator('[data-sec="00000000-0000-4000-8000-000000000002"]');
  await expect(block).toHaveCSS("background-color", "rgb(11, 45, 91)");
  await expect(block).toHaveCSS("color", "rgb(255, 255, 255)");
  await expectNoSeriousA11yViolations(page);
});
