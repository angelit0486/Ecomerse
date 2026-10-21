import { expect, test, type Page } from "@playwright/test";

import { admin, createAuthUser, createTenant, uniq } from "./support";

/**
 * Fotos de producto con fondo negro (reporte del propietario, 2026-10-22): sobre
 * una tienda de fondo oscuro, `mix-blend-mode: multiply` volvía negro el fondo
 * blanco de cada foto. Con fondo claro se multiplica; con oscuro, la foto va tal cual.
 */
const run = uniq();
type Tenant = Awaited<ReturnType<typeof createTenant>>;
let light: Tenant;
let dark: Tenant;
const origin = (t: Tenant) => `http://${t.handle}.localhost:3000`;

async function publishWithPhoto(t: Tenant, ownerId: string, slug: string) {
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${t.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${t.storeId}, ${sql.json({
        title: "Proteína con foto",
        slug,
        variants: [{ price: 59900, sku: `${slug}-${run}`.toUpperCase() }],
      })}) as r`;
    await sql`set local role postgres`;
    await sql`insert into public.media (store_id, owner_type, product_id, status, storage_path, position, alt_text, width, height)
              values (${t.storeId}, 'product', ${p!.r.id}, 'ready', ${`e2e/${run}/${slug}.webp`}, 0, 'Bote de proteína', 800, 800)`;
    await sql`set local role authenticated`;
    await sql`select public.catalog_publish_product(${t.storeId}, ${p!.r.id})`;
  });
}

test.beforeAll(async () => {
  const lightOwner = await createAuthUser(`foto-clara-${run}@example.test`);
  const darkOwner = await createAuthUser(`foto-oscura-${run}@example.test`);
  light = await createTenant(`fc${run}`, lightOwner);
  dark = await createTenant(`fo${run}`, darkOwner);
  await admin`update public.store_themes
                 set settings = ${admin.json({
                   colors: {
                     background: "#000000",
                     foreground: "#ffffff",
                     muted: "#bababa",
                     primary: "#ffd60a",
                     accent: "#38ff14",
                   },
                 })}
               where store_id = ${dark.storeId}`;
  await publishWithPhoto(light, lightOwner, "proteina-clara");
  await publishWithPhoto(dark, darkOwner, "proteina-oscura");
});

const blendOf =
  (url: string) =>
  async ({ page }: { page: Page }) => {
    await page.goto(url);
    const photo = page.getByRole("img", { name: "Bote de proteína" }).first();
    await expect(photo).toBeAttached();
    return photo.evaluate((el) => getComputedStyle(el).mixBlendMode);
  };

test("fondo claro: la foto se multiplica; fondo oscuro: la foto va tal cual", async ({ page }) => {
  expect(await blendOf(`${origin(light)}/productos/proteina-clara`)({ page })).toBe("multiply");
  expect(await blendOf(`${origin(dark)}/productos/proteina-oscura`)({ page })).toBe("normal");
  // También en las tarjetas del listado.
  expect(await blendOf(`${origin(dark)}/productos`)({ page })).toBe("normal");
});
