import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  runJobs,
  uniq,
} from "./support";

/**
 * Portada de imágenes (interruptor hero_image_carousel): la dueña sube varias
 * imágenes de una vez, escribe el texto alternativo, ve la vista previa en vivo,
 * guarda y publica; el comprador ve solo imágenes que avanzan solas y puede
 * deslizar. Con el interruptor apagado el panel no ofrece el bloque y la tienda
 * no lo dibuja.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `carrusel-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const store = () => `http://${tenant.handle}.localhost:3000`;

const png = (color: string, width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer();

async function trackCsp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
}

const setFlag = (enabled: boolean) => admin`
  insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
  values ('hero_image_carousel', 'store', ${tenant.storeId}, ${enabled}, 'Prueba E2E de la portada de imágenes')
  on conflict (flag_key, scope, scope_id) do update set enabled = excluded.enabled`;

test.beforeAll(async () => {
  tenant = await createTenant(`ic${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
});

test("subir varias imágenes, vista previa en vivo, guardar, publicar y verla en la tienda", async ({
  page,
  browser,
}) => {
  await loginNewStaff(page, ownerEmail);
  // Apagada para la tienda (nace encendida desde 2026-11-04), el panel no la ofrece.
  await setFlag(false);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);
  const options = await page.getByLabel("Nuevo bloque").locator("option").allTextContents();
  expect(options).toContain("Portada principal");
  expect(options).not.toContain("Portada de imágenes");

  await setFlag(true);
  await page.reload();
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Portada de imágenes" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await expect(page.getByText(/Tamaño recomendado: computadora 2400 × 1029 px/)).toBeVisible();

  // Varias de una vez, como desde la galería del celular; una es pequeña.
  await page.getByLabel("Agregar imágenes (puedes elegir varias de tu galería)").setInputFiles([
    { name: "grande.png", mimeType: "image/png", buffer: await png("#1d4ed8", 2400, 1029) },
    { name: "chica.png", mimeType: "image/png", buffer: await png("#b91c1c", 800, 343) },
  ]);
  await page.getByRole("button", { name: "Subir y agregar" }).click();
  await expect(page.getByText("Procesando las imágenes…")).toBeVisible({ timeout: 30_000 });
  await runJobs();
  await expect(page.getByText(/Imágenes listas y agregadas/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Imagen 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Imagen 2", { exact: true })).toBeVisible();
  // Aviso de baja resolución en la pequeña.
  await expect(
    page.getByText(/mide 800 px de ancho: en la computadora se verá borrosa/),
  ).toBeVisible();

  // Sin texto alternativo no se guarda.
  await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Imagen 1, Texto alternativo" }),
  ).toBeVisible();

  await page
    .getByLabel("Texto alternativo de la imagen 1 (obligatorio)")
    .fill("Proteínas en oferta");
  await page
    .getByLabel("Texto alternativo de la imagen 2 (obligatorio)")
    .fill("Envío gratis desde $999");
  await page.getByLabel("Al tocar la imagen 1, ir a (opcional)").fill("/productos");
  // Reordenar y duplicar.
  await page.getByRole("button", { name: "Bajar la imagen 1" }).click();
  await expect(page.getByLabel("Texto alternativo de la imagen 2 (obligatorio)")).toHaveValue(
    "Proteínas en oferta",
  );
  await page.getByRole("button", { name: "Subir la imagen 2" }).click();

  // Vista previa en vivo, en celular y en computadora.
  const live = page.getByRole("region", { name: "Vista previa en vivo" });
  await expect(live.getByRole("img", { name: "Proteínas en oferta" })).toBeVisible();
  await live.getByRole("button", { name: "Computadora" }).click();
  await expect(live.getByRole("button", { name: "Computadora" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portada guardada en el borrador" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByRole("button", { name: "Sí, publicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: /publicad/i })).toBeVisible();

  // Comprador en el celular.
  const buyer = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const shopper = await buyer.newPage();
  await trackCsp(shopper);
  await shopper.goto(store());
  const carousel = shopper.getByRole("region", { name: "Portada" });
  await expect(carousel).toBeVisible();
  // Solo imágenes: el h1 es el nombre de la tienda, solo para lectores de pantalla.
  await expect(shopper.locator("h1")).toHaveClass(/sr-only/);
  const first = carousel.getByRole("img", { name: "Proteínas en oferta" });
  await expect(first).toHaveAttribute("fetchpriority", "high");
  await expect(carousel.getByRole("link")).toHaveAttribute("href", "/productos");
  const dot = (n: number) => carousel.getByRole("button", { name: `Ver imagen ${n}` });
  await expect(dot(1)).toHaveAttribute("aria-current", "true");
  // Avanza sola a los 4 s.
  await expect(dot(2)).toHaveAttribute("aria-current", "true", { timeout: 6_000 });
  // Deslizar con el dedo (o el mouse) regresa y el temporizador sigue.
  const box = (await carousel.boundingBox())!;
  await shopper.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await shopper.mouse.down();
  await shopper.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 });
  await shopper.mouse.up();
  await expect(dot(1)).toHaveAttribute("aria-current", "true");
  await expect(dot(2)).toHaveAttribute("aria-current", "true", { timeout: 6_000 });
  // Pausa.
  await carousel.getByRole("button", { name: "Pausar el avance automático" }).click();
  await shopper.waitForTimeout(4_500);
  await expect(dot(2)).toHaveAttribute("aria-current", "true");
  await expectNoSeriousA11yViolations(shopper);
  expect(await shopper.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual(
    [],
  );

  // Interruptor apagado: la tienda no la dibuja (aunque siga publicada).
  await setFlag(false);
  await shopper.reload();
  await expect(shopper.getByRole("region", { name: "Portada" })).toHaveCount(0);
  await buyer.close();
});
