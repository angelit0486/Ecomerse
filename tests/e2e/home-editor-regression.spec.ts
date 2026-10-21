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
 * Diagnóstico de la portada (docs/plan/DIAGNOSTICO-PORTADA.md): la tienda queda
 * como `demo` en staging (portada principal oculta, rieles por un filtro,
 * borrador del tema con anuncio y emojis) y la dueña vuelve a editarla en el
 * celular y en la computadora.
 */
const run = uniq();

async function seed(key: string) {
  const ownerEmail = `portada-reg-${key}-${run}@example.test`;
  const ownerId = await createAuthUser(ownerEmail);
  const tenant = await createTenant(`pr${key}${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [attribute] = await sql<{ id: string }[]>`
      select public.catalog_save_attribute(${tenant.storeId},
        ${sql.json({ name: "Gramos", values: [{ label: "2gramos" }, { label: "3.5gramos" }] })}) as id`;
    const values = await sql<{ id: string }[]>`
      select id from public.attribute_values where attribute_id = ${attribute!.id} order by position`;
    const [category] = await sql<{ r: string }[]>`
      select public.catalog_upsert_category(${tenant.storeId}, ${sql.json({ name: "Plumas" })}) as r`;
    const sections = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "hero",
        enabled: false,
        props: {
          heading: "Plumas originales a la puerta de tu casa",
          subheading: "Elige por gramos, sabor o marca.",
          align: "center",
          cta: { label: "Ver productos", link: "/productos" },
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        type: "featured_products",
        enabled: true,
        props: {
          title: "Para tu energía",
          limit: 4,
          show_view_all: true,
          source: { type: "attribute_value", id: values[0]!.id },
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        type: "category_grid",
        enabled: true,
        props: { title: "Compra por categoría", category_ids: [category!.r] },
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        type: "featured_products",
        enabled: true,
        props: {
          title: "Para tu fuerza",
          limit: 4,
          show_view_all: true,
          source: { type: "attribute_value", id: values[1]!.id },
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        type: "featured_products",
        enabled: true,
        props: { title: "Lo más nuevo", limit: 8, show_view_all: true, source: { type: "newest" } },
      },
    ];
    await sql`select public.appearance_save_home_draft(${tenant.storeId}, ${sql.json(sections)}, 0)`.catch(
      (e: { detail?: string; hint?: string }) => {
        throw new Error(`home: ${e.detail} ${e.hint}`);
      },
    );
    await sql`select public.appearance_publish_theme(${tenant.storeId}, 1)`;
    await sql`select public.appearance_save_theme_draft(${tenant.storeId}, ${sql.json({
      header: {
        announcement: {
          text: "Plumas originales a la puerta de tu casa🚪🏘🥦",
          background: "#432e6b",
          foreground: "#ffffff",
        },
      },
    })}, 2)`;
  });
  return { tenant, ownerEmail };
}

for (const viewport of [
  { name: "celular", key: "m", width: 375, height: 812 },
  { name: "computadora", key: "d", width: 1280, height: 900 },
]) {
  test(`volver a editar la portada en ${viewport.name}`, async ({ page }) => {
    const { tenant, ownerEmail } = await seed(viewport.key);
    await page.setViewportSize(viewport);
    await loginNewStaff(page, ownerEmail);
    await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);
    const hero = page.getByRole("listitem").filter({ hasText: "1. Portada principal" });
    await expect(hero.getByText("Oculto: tus clientes no ven este bloque.")).toBeVisible();
    // R2: el aviso lleva a mostrar la que ya existe en vez de crear otra.
    await expect(page.getByText("Tu portada principal está oculta")).toBeVisible();
    await page.getByRole("button", { name: "Mostrar la portada principal" }).click();
    await expect(page.getByText("Tu portada principal está oculta")).toHaveCount(0);
    await hero.getByRole("button", { name: "Editar Portada principal" }).click();
    const subtitle = hero.getByLabel(/Subtítulo/);
    await expect(subtitle).toHaveValue(/Elige por gramos/);
    await subtitle.fill(`Envío en 24 horas (${viewport.name})`);
    // R3: un enlace que no existe avisa y sugiere la página correcta.
    await hero.getByLabel("Enlace del botón").fill("/plumas");
    await expect(hero.getByText("¿Quisiste decir «/categoria/plumas»?")).toBeVisible();
    await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Portada guardada en el borrador, pero revisa" }),
    ).toBeVisible();
    await hero.getByLabel("Enlace del botón").fill("/categoria/plumas");
    await expect(hero.getByText(/Quisiste decir/)).toHaveCount(0);
    await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Portada guardada en el borrador. Revísala en la vista previa" }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    const [row] = await admin<
      { s: { enabled: boolean; props: { subheading: string; cta: { link: string } } } }[]
    >`select draft_home_sections->0 as s from public.store_themes where store_id = ${tenant.storeId}`;
    expect(row!.s.enabled).toBe(true);
    expect(row!.s.props.subheading).toBe(`Envío en 24 horas (${viewport.name})`);
    expect(row!.s.props.cta.link).toBe("/categoria/plumas");
  });
}

test("tienda en el celular: el primer acceso rápido se ve completo", async ({ page }) => {
  const { tenant } = await seed("q");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`http://${tenant.handle}.localhost:3000/`);
  const first = page.getByRole("navigation", { name: "Accesos rápidos" }).getByRole("link").first();
  const box = (await first.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  // El texto empieza en el margen de la página (16 px), no pegado al borde.
  const text = await first.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().x;
  });
  expect(Math.round(text)).toBe(16);
});
