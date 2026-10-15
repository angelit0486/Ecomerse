import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * F9-T01 (GATE0 §20.2, F9-DESIGN §5–§8): la dueña edita la apariencia por
 * pestañas en un borrador, la ve en la vista previa (sus clientes no) y la
 * publica. Sin violaciones de CSP en la tienda.
 */
const run = uniq();
const ownerEmail = `apariencia-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId = "";

const store = () => `http://${tenant.handle}.localhost:3000`;
const BAR = "Envío gratis en compras desde $999";

/** Registra las violaciones de CSP de todas las páginas del contexto (también las pestañas nuevas). */
async function trackCsp(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
}

async function cspViolations(page: Page): Promise<string[]> {
  // Sin `?? []`: si el registro no se instaló, la prueba falla en lugar de pasar vacía.
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`ap${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(),
                 contact_email = ${`hola-${run}@example.test`} where id = ${tenant.storeId}`;
});

test("editar por pestañas, vista previa privada y publicar", async ({ page, browser }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Apariencia" }).click();
  await expect(page.getByRole("heading", { name: "Apariencia", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Todo está publicado" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Marca: tipografía y botones de contorno.
  await choose(page, "Títulos", "Oswald (condensada, deportiva)");
  await choose(page, "Estilo", "Contorno");
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Guardado en el borrador" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hay cambios sin publicar" })).toBeVisible();

  // Encabezado y pie: el contraste insuficiente se marca antes de guardar.
  await page.getByRole("link", { name: "Encabezado y pie" }).click();
  await page.getByLabel("Barra de anuncio").fill(BAR);
  await page.getByLabel("Enlace de la barra (opcional)").fill("/productos");
  await page.getByLabel("Texto de la barra").fill("#333333");
  await expect(page.getByText(/necesita al menos 4\.5:1/)).toBeVisible();
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "contraste" })).toBeVisible();
  await expect(page.getByLabel("Barra de anuncio")).toHaveValue(BAR);
  await page.getByLabel("Texto de la barra").fill("#ffffff");
  await page.getByLabel("OXXO").check();
  await page.getByLabel("SPEI (transferencia)").check();
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Guardado en el borrador" }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Redes y contacto: una red con otro dominio se rechaza en su campo.
  await page.getByRole("link", { name: "Redes y contacto" }).click();
  await page.getByLabel("Instagram").fill("https://evil.example.com/x");
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(page.getByText("La dirección debe ser https:// de esa red social.")).toBeVisible();
  await page.getByLabel("Instagram").fill(`instagram.com/tienda${run}`);
  await page.getByLabel("WhatsApp", { exact: true }).fill("55 1234 5678");
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Guardado en el borrador" }),
  ).toBeVisible();

  // SEO global.
  await page.getByRole("link", { name: "SEO" }).click();
  await page.getByLabel("Título de la portada").fill("Suplementos para tu objetivo");
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Guardado en el borrador" }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Un comprador (otro navegador) sigue viendo lo publicado.
  const buyer = await browser.newContext();
  const shopper = await buyer.newPage();
  await trackCsp(shopper);
  await shopper.goto(store());
  await expect(shopper.getByText(BAR)).toHaveCount(0);

  // Vista previa: el borrador, con su aviso.
  await trackCsp(page.context());
  const [preview] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("link", { name: /Vista previa/ }).click(),
  ]);
  await preview.waitForURL(`${store()}/`);
  await expect(
    preview.getByText("Vista previa del borrador: tus clientes ven la versión publicada."),
  ).toBeVisible();
  await expect(preview.getByRole("link", { name: BAR })).toHaveAttribute("href", "/productos");
  await expect(preview.getByRole("link", { name: /Instagram/ })).toHaveAttribute(
    "href",
    `https://instagram.com/tienda${run}`,
  );
  await expect(preview).toHaveTitle("Suplementos para tu objetivo");
  await expectNoSeriousA11yViolations(preview);
  expect(await cspViolations(preview)).toEqual([]);

  // La vista previa no se filtra a la caché pública.
  await shopper.reload();
  await expect(shopper.getByText(BAR)).toHaveCount(0);

  // Salir de la vista previa vuelve a lo publicado.
  await preview.getByRole("button", { name: "Salir de la vista previa" }).click();
  await expect(preview.getByText(BAR)).toHaveCount(0);
  await preview.close();

  // Publicar: los clientes lo ven al instante.
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Todo está publicado" })).toBeVisible();
  const fonts = new Set<string>();
  shopper.on("request", (r) => {
    if (r.resourceType() === "font") fonts.add(new URL(r.url()).pathname);
  });
  await shopper.reload();
  await expect(shopper.getByRole("link", { name: BAR })).toBeVisible();
  await shopper.waitForLoadState("networkidle");
  // Oswald (títulos) e Inter (textos): solo las dos fuentes elegidas, del propio dominio.
  expect(fonts.size).toBeGreaterThanOrEqual(1);
  expect(fonts.size).toBeLessThanOrEqual(2);
  await expect(shopper.getByRole("contentinfo").getByText("OXXO")).toBeVisible();
  await expect(shopper.getByRole("link", { name: /WhatsApp \+525512345678/ })).toHaveAttribute(
    "href",
    "https://wa.me/525512345678",
  );
  await expect(shopper).toHaveTitle("Suplementos para tu objetivo");
  const icon = await shopper.locator('link[rel="icon"]').getAttribute("href");
  expect(icon).toMatch(/^\/icon\.svg\?v=\d+$/);
  // Desde el navegador (Node no resuelve *.localhost): mismo origen que la tienda.
  const iconResponse = await shopper.evaluate(async (url) => {
    const r = await fetch(url);
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      cache: r.headers.get("cache-control"),
      body: await r.text(),
    };
  }, icon!);
  expect(iconResponse).toMatchObject({
    status: 200,
    type: "image/svg+xml",
    cache: "public, max-age=86400",
  });
  expect(iconResponse.body).toContain(`>${tenant.name.trim()[0]!.toUpperCase()}</text>`);
  await expectNoSeriousA11yViolations(shopper);
  expect(await cspViolations(shopper)).toEqual([]);
  await buyer.close();

  // Descartar un borrador vuelve a lo publicado, también en los formularios.
  await page.getByLabel("Título de la portada").fill("Título que se descarta");
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(page.getByRole("heading", { name: "Hay cambios sin publicar" })).toBeVisible();
  await page.getByRole("button", { name: "Descartar borrador" }).click();
  await expect(page.getByText("Marca la casilla para confirmar")).toBeVisible();
  await page.getByLabel("Quiero descartar todos los cambios sin publicar").check();
  await page.getByRole("button", { name: "Descartar borrador" }).click();
  await expect(
    page.getByText("Cambios descartados. Volviste a la versión publicada."),
  ).toBeVisible();
  await expect(page.getByLabel("Título de la portada")).toHaveValue("Suplementos para tu objetivo");
  await expect(page.getByRole("heading", { name: "Todo está publicado" })).toBeVisible();
});

test("otra persona cambió el borrador: conflicto en lugar de pisarlo", async ({ page }) => {
  // Una administradora de la tienda (con appearance.manage) y la dueña editan a la vez.
  const email = `apariencia-b-${run}@example.test`;
  const adminId = await createAuthUser(email);
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${tenant.orgId}, ${adminId}, 'org_member')`;
  await admin`insert into public.store_members (store_id, user_id, role_id)
              select ${tenant.storeId}, ${adminId}, r.id from public.roles r
               where r.key = 'store_admin' and r.organization_id is null`;
  await loginNewStaff(page, email);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=seo`);
  await page.getByLabel("Título de la portada").fill("Mi cambio");
  // Mientras tanto, la dueña guarda desde otra sesión.
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.appearance_save_theme_draft(${tenant.storeId},
                ${sql.json({ seo: { title: "Cambio de la dueña" } })},
                (select draft_revision from public.store_themes where store_id = ${tenant.storeId}))`;
  });
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(page.getByText(/Otra persona cambió la apariencia mientras tanto/)).toBeVisible();
  const [row] = await admin<{ title: string }[]>`
    select draft_settings #>> '{seo,title}' as title from public.store_themes where store_id = ${tenant.storeId}`;
  expect(row!.title).toBe("Cambio de la dueña");
});
