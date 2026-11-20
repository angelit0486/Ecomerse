import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  uniq,
} from "./support";

/**
 * Tema de presentación «Nocturno» (looks.ts): se enciende solo con la clave de
 * tema `nocturno`. Dos tiendas en la misma base: la que conserva la clave `base`
 * se ve exactamente como antes; la otra se dibuja oscura, sin desbordar en
 * ningún ancho y sin violaciones serias de accesibilidad.
 */
const run = uniq();
let base: Awaited<ReturnType<typeof createTenant>>;
let nocturno: Awaited<ReturnType<typeof createTenant>>;

const url = (t: { handle: string }, path = "/") => `http://${t.handle}.localhost:3000${path}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(`look-${run}@example.test`);
  base = await createTenant(`lb${run}`, ownerId);
  nocturno = await createTenant(`ln${run}`, ownerId);
  for (const t of [base, nocturno]) {
    await admin`update public.stores set status = 'active', launched_at = now() where id = ${t.storeId}`;
    await admin.begin(async (sql) => {
      await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
      await sql`set local role authenticated`;
      for (const title of ["Estuche (DEMO)", "Gorra (DEMO)", "Taza (DEMO)", "Póster (DEMO)"]) {
        const sku = `${title.slice(0, 3).toUpperCase()}-${t.handle}`;
        const [p] = await sql<{ r: { id: string } }[]>`
          select public.catalog_upsert_product(${t.storeId},
            ${sql.json({ title, variants: [{ price: 49900, sku }] })}) as r`;
        const [v] = await sql<{ id: string }[]>`
          select id from public.product_variants where store_id = ${t.storeId} and sku = ${sku.toUpperCase()}`;
        await sql`select public.inventory_adjust(${t.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
        await sql`select public.catalog_publish_product(${t.storeId}, ${p!.r.id})`;
        // Dos fotos para el estuche (archivos inexistentes: basta su registro para la galería).
        if (title === "Estuche (DEMO)") {
          await sql`set local role postgres`;
          for (const n of [0, 1]) {
            await sql`insert into public.media (store_id, owner_type, product_id, status, storage_path, position, width, height)
                      values (${t.storeId}, 'product', ${p!.r.id}, 'ready', ${`e2e/${run}/${t.handle}-estuche-${n}.jpg`}, ${n}, 1200, 1200)`;
          }
          await sql`set local role authenticated`;
        }
      }
    });
  }
  // Antes de la primera visita (la lectura pública de la tienda se guarda en caché).
  // Logo de insignia (archivo inexistente: basta su registro para el emblema + nombre).
  const [logo] = await admin<{ id: string }[]>`
    insert into public.media (store_id, owner_type, status, storage_path, position, width, height)
    values (${nocturno.storeId}, 'store_branding', 'ready', ${`e2e/${run}/logo.jpg`}, 0, 1168, 784)
    returning id`;
  const logoId = logo!.id;
  await admin`update public.store_themes
                 set theme_key = 'nocturno',
                     logo_media_id = ${logoId},
                     settings = settings || ${admin.json({ contact: { whatsapp: "+526621234567" } })}
               where store_id = ${nocturno.storeId}`;
});

test("la clave «base» no cambia nada; «nocturno» enciende el tema solo en su tienda", async ({
  page,
}) => {
  await page.goto(url(base, "/productos"));
  const plain = page.locator(".sf-root");
  await expect(plain).not.toHaveAttribute("data-look", /.*/);
  expect(await plain.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(255, 255, 255)",
  );

  await page.goto(url(nocturno, "/productos"));
  const dark = page.locator(".sf-root");
  await expect(dark).toHaveAttribute("data-look", "nocturno");
  expect(await dark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(9, 9, 13)");
  // Títulos en Space Grotesk y texto en Inter (fuentes autoalojadas de la lista curada).
  const fonts = await page.evaluate(() => ({
    heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
    body: getComputedStyle(document.querySelector(".sf-root")!).fontFamily,
  }));
  expect(fonts.heading).toMatch(/barlow ?condensed/i);
  expect(fonts.body).toMatch(/manrope/i);
  await expect(page.getByRole("link", { name: "Estuche (DEMO)" })).toBeVisible();
  // Los datos son los de la tienda: precio real y botón de compra intactos.
  await expect(page.getByText("$499.00").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Agregar Estuche \(DEMO\) al carrito/ }),
  ).toBeVisible();
});

for (const width of [360, 390, 430, 768, 1024, 1440]) {
  test(`nocturno a ${width} px: sin desbordamiento ni violaciones serias`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/productos"]) {
      await page.goto(url(nocturno, path));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} desborda ${overflow}px`).toBeLessThanOrEqual(0);
    }
    if (width === 390 || width === 1440) await expectNoSeriousA11yViolations(page);
  });
}

test("nocturno: cuenta regresiva al corte de envío (4:20 pm, Hermosillo); «base» no la muestra", async ({
  page,
}) => {
  // Lunes 2026-11-16 a las 14:00 en Hermosillo (UTC−7).
  await page.clock.setFixedTime(new Date("2026-11-16T21:00:00Z"));
  await page.goto(url(nocturno, "/"));
  const cutoff = page.getByRole("complementary", { name: "Hora de corte de envío" });
  await expect(cutoff).toContainText(
    "Llega mañana si pides y pagas en 2:20:00 Corte a las 4:20 pm, hora de Sonora.",
  );
  // Viernes después del corte: no hay entregas el fin de semana.
  await page.clock.setFixedTime(new Date("2026-11-21T00:30:00Z"));
  await page.reload();
  await expect(cutoff).toContainText("Pide hoy y llega el martes. Sin entregas sábado ni domingo.");
  await page.goto(url(base, "/"));
  await expect(page.getByRole("complementary", { name: "Hora de corte de envío" })).toHaveCount(0);
});

test("nocturno: sin violaciones de accesibilidad, ni moderadas, en inicio y 404", async ({
  page,
}) => {
  for (const path of ["/", "/no-existe-esta-pagina"]) {
    await page.goto(url(nocturno, path));
    await expect(
      page.getByRole("complementary", { name: "Contacto por WhatsApp" }).getByRole("link"),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page, { includeModerate: true });
  }
});

test("nocturno: con logo, el encabezado muestra emblema + nombre; «base» no cambia", async ({
  page,
}) => {
  await page.goto(url(nocturno, "/"));
  const home = page.locator("header.sf-el-header a[href='/']").first();
  await expect(home.locator(".sf-wordmark-lockup")).toHaveText(
    `Tienda ${`ln${run}`.toUpperCase()}`,
  );
  await expect(home.locator("img")).toHaveAttribute("alt", "");
  await page.goto(url(base, "/"));
  await expect(page.locator(".sf-wordmark-lockup")).toHaveCount(0);
});

test("nocturno: la ficha dice cuándo llega si compras ahora; «base» no", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-16T21:00:00Z")); // lunes 14:00 en Hermosillo
  await page.goto(url(nocturno, "/productos"));
  await page.getByRole("link", { name: "Estuche (DEMO)" }).first().click();
  await expect(page.locator("[data-cutoff=inline]")).toContainText(
    "Llega mañana si pides y pagas en 2:20:00",
  );
  await page.goto(url(base, "/productos"));
  await page.getByRole("link", { name: "Estuche (DEMO)" }).first().click();
  await expect(page.getByRole("heading", { name: "Estuche (DEMO)" })).toBeVisible();
  await expect(page.locator("[data-cutoff=inline]")).toHaveCount(0);
});

test("nocturno: la franja de la hora de corte no mueve la página al cargar (CLS)", async ({
  page,
}) => {
  // Antes, el servidor dibujaba la regla fija (dos renglones en el celular) y el
  // navegador la cambiaba por la cuenta regresiva (uno): todo subía 16 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
        if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  for (const path of ["/", "/productos"]) {
    await page.goto(url(nocturno, path), { waitUntil: "networkidle" });
    await expect(page.locator(".sf-cutoff time, .sf-cutoff p").first()).toBeVisible();
    // Dos «tics» del reloj: el texto ya era el del servidor y solo cambian los dígitos.
    await page.waitForTimeout(2_200);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `CLS en ${path}`).toBeLessThan(0.05);
  }
});

test("nocturno: al agregar se abre el carrito lateral; «base» conserva su aviso", async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url(nocturno, "/productos"));
    await page.getByRole("link", { name: "Estuche (DEMO)" }).first().click();
    await page.getByRole("button", { name: "Agregar al carrito" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Agregado a tu carrito" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Estuche (DEMO)");
    await expect(sheet.getByRole("link", { name: "Pagar ahora" })).toHaveAttribute(
      "href",
      "/checkout",
    );
    await expectNoSeriousA11yViolations(page);
    // Esc cierra y la página vuelve a responder.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
  // Desde una tarjeta también, y «Seguir comprando» lo cierra.
  await page.goto(url(nocturno, "/productos"));
  await page.getByRole("button", { name: /Agregar Gorra \(DEMO\) al carrito/ }).click();
  const fromCard = page.getByRole("dialog", { name: "Agregado a tu carrito" });
  await expect(fromCard).toContainText("Gorra (DEMO)");
  await fromCard.getByRole("button", { name: "Seguir comprando" }).click();
  await expect(fromCard).toBeHidden();

  // La tienda base no cambia: aviso en la ficha y ningún panel.
  await page.goto(url(base, "/productos"));
  await page.getByRole("link", { name: "Estuche (DEMO)" }).first().click();
  await page.getByRole("button", { name: "Agregar al carrito" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Agregado a tu carrito" })).toHaveCount(0);
});

test("nocturno: la galería se desliza y la foto se amplía; «base» no cambia", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(nocturno, "/productos"));
  await page.getByRole("link", { name: "Estuche (DEMO)" }).first().click();
  const first = page.getByRole("button", { name: "Ampliar foto 1 de 2" });
  await expect(first).toBeVisible();

  // Deslizar a la izquierda pasa a la segunda foto, sin abrir la ampliación.
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Ampliar foto 2 de 2" })).toBeVisible();
  const zoom = page.getByRole("dialog", { name: "Foto ampliada de Estuche (DEMO)" });
  await expect(zoom).toBeHidden();

  // Tocar la foto la abre ampliada; ← → cambian de foto; Esc cierra.
  await page.getByRole("button", { name: "Ampliar foto 2 de 2" }).click();
  await expect(zoom).toBeVisible();
  await expect(zoom).toContainText("2 de 2");
  await page.keyboard.press("ArrowRight");
  await expect(zoom).toContainText("1 de 2");
  await zoom.getByRole("button", { name: "Acercar la foto" }).click();
  await expect(zoom.getByRole("button", { name: "Alejar la foto" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectNoSeriousA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(zoom).toBeHidden();
  await expect(page.getByRole("button", { name: "Ampliar foto 1 de 2" })).toBeFocused();

  // La tienda base conserva su galería de siempre.
  await page.goto(url(base, "/productos"));
  await page.getByRole("link", { name: "Estuche (DEMO)" }).first().click();
  await expect(page.getByRole("button", { name: "Imagen siguiente" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ampliar foto/ })).toHaveCount(0);
});

test("nocturno: el menú del celular cubre toda la pantalla", async ({ page }) => {
  // Un filtro en el encabezado volvía a éste el contenedor del menú «fixed».
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(nocturno, "/"));
  await page.getByRole("button", { name: "Menú" }).click();
  const menu = page.getByRole("dialog", { name: "Menú" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(840);
  expect(box?.y ?? 1).toBe(0);
});

test("nocturno respeta «reducir movimiento»: nada se anima", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(url(nocturno, "/"));
  const animated = await page.evaluate(
    () =>
      [...document.querySelectorAll(".sf-root *")].filter(
        (el) => getComputedStyle(el).animationName !== "none",
      ).length,
  );
  expect(animated).toBe(0);
  await context.close();
});
