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
 * Misión Portada/Marcas, Paso 3 (tema v3): la dueña agrega una segunda portada
 * que rota, elige foto de fondo, apaga la barra de anuncio sin borrarla,
 * publica con confirmación y deshace la publicación.
 */
const run = uniq();
const ownerEmail = `hero3-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const store = () => `http://${tenant.handle}.localhost:3000`;
const ANNOUNCEMENT = "Envío gratis desde $999 a todo México";

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`h3${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.appearance_save_home_draft(${tenant.storeId}, ${sql.json([
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "hero",
        enabled: true,
        props: { heading: "Suplementos originales", align: "left" },
      },
    ])}, 0)`;
    await sql`select public.appearance_save_theme_draft(${tenant.storeId}, ${sql.json({
      header: {
        announcement: { text: ANNOUNCEMENT, background: "#111827", foreground: "#ffffff" },
      },
    })}, 1)`;
    await sql`select public.appearance_publish_theme(${tenant.storeId}, 2)`;
  });
});

test("varias portadas, barra apagada, publicar con confirmación y deshacer", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginNewStaff(page, ownerEmail);

  // Portada: una segunda portada que rota y foto de fondo.
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);
  const hero = page.getByRole("listitem").filter({ hasText: "1. Portada principal" });
  await hero.getByRole("button", { name: "Editar Portada principal" }).click();
  await hero.getByLabel("Presentación").selectOption("background");
  await hero.getByRole("button", { name: "Agregar otra portada" }).click();
  await hero.getByLabel("Título de la portada 2", { exact: true }).fill("Proteínas para tu fuerza");
  await hero.getByLabel("Que roten solas cada 6 segundos").check();
  await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portada guardada en el borrador" }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Barra de anuncio: se apaga sin perder el texto.
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=encabezado`);
  await page.getByLabel("Mostrar el anuncio en la tienda").uncheck();
  await expect(page.getByLabel("Barra de anuncio", { exact: true })).toHaveValue(ANNOUNCEMENT);
  await page.getByRole("button", { name: "Guardar en el borrador" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "borrador" }).first()).toBeVisible();

  // Publicar pide confirmación.
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("¿Publicar los cambios?")).toBeVisible();
  await page.getByRole("button", { name: "Sí, publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();

  const [theme] = await admin<{ s: { props: Record<string, unknown> }; a: { hidden?: boolean } }[]>`
    select home_sections->0 as s, settings#>'{header,announcement}' as a
      from public.store_themes where store_id = ${tenant.storeId}`;
  expect(theme!.s.props).toMatchObject({
    layout: "background",
    autoplay: true,
    slides: [{ heading: "Proteínas para tu fuerza" }],
  });
  expect(theme!.a).toMatchObject({ text: ANNOUNCEMENT, hidden: true });

  // La tienda en el celular: carrusel accesible y sin barra de anuncio.
  const shopper = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await shopper.emulateMedia({ reducedMotion: "reduce" });
  await shopper.goto(store());
  await expect(shopper.getByText(ANNOUNCEMENT)).toHaveCount(0);
  const carousel = shopper.getByRole("region", { name: "Portadas" });
  await expect(carousel.getByRole("heading", { name: "Suplementos originales" })).toBeVisible();
  await expect(carousel.getByRole("button", { name: "Pausar portadas" })).toBeVisible();
  await carousel.getByRole("button", { name: "Portada siguiente" }).click();
  await expect(carousel.getByRole("heading", { name: "Proteínas para tu fuerza" })).toBeVisible();
  await expect(carousel.getByRole("heading", { name: "Suplementos originales" })).toBeHidden();
  const box = (await carousel.getByRole("button", { name: "Portada siguiente" }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expectNoSeriousA11yViolations(shopper);

  // Deshacer: vuelve la versión anterior (una portada y la barra encendida).
  await page.getByRole("button", { name: "Deshacer la última publicación" }).click();
  await page.getByRole("button", { name: "Sí, deshacer" }).click();
  await expect(page.getByText(/Listo: volviste a la versión 1/)).toBeVisible();
  await shopper.reload();
  await expect(shopper.getByText(ANNOUNCEMENT)).toBeVisible();
  await expect(shopper.getByRole("region", { name: "Portadas" })).toHaveCount(0);
  await expect(shopper.getByRole("heading", { name: "Suplementos originales" })).toBeVisible();
  await shopper.close();
});
