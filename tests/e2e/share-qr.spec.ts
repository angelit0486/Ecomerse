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
 * Compartir (Orden 10, O10-03): enlace directo, WhatsApp y QR de la tienda y
 * de cada producto. Solo con la tienda publicada; el enlace usa el dominio de
 * la tienda y abre sin iniciar sesión; se ve bien en un celular.
 */
const run = uniq();
const ownerEmail = `compartir-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let productId: string;
const slug = `cafe-de-olla-${run}`;
const storeOrigin = () => `http://${tenant.handle}.localhost:3000`;

test.beforeAll(async () => {
  tenant = await createTenant(`qr${run}`, await createAuthUser(ownerEmail));
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Café de olla 500 g', ${slug}, 'active', now()) returning id`;
  productId = p!.id;
  await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature)
              values (${tenant.storeId}, ${productId}, ${`QR-${run}`}, 12900, '')`;
});

test("solo con la tienda publicada: enlace, WhatsApp, copiar y QR descargable", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3000",
  });
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;

  // Tienda en borrador: no hay nada que compartir todavía.
  await page.goto(`${base}/configuracion`);
  await expect(page.getByRole("heading", { name: "Publicar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comparte tu tienda" })).toHaveCount(0);
  await page.goto(`${base}/productos/${productId}`);
  await expect(page.getByText("Compartir este producto")).toHaveCount(0);

  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;

  // Tienda: dominio propio de la tienda, nunca el del panel.
  await page.goto(`${base}/configuracion`);
  const storeShare = page.getByRole("region", { name: "Comparte tu tienda" });
  await expect(storeShare.getByLabel("Enlace")).toHaveValue(`${storeOrigin()}/`);
  const storeWa = await storeShare
    .getByRole("link", { name: /Compartir por WhatsApp/ })
    .getAttribute("href");
  expect(storeWa).toBe(
    `https://wa.me/?text=${encodeURIComponent(`Visita ${tenant.name} y haz tu pedido en línea:\n${storeOrigin()}/`)}`,
  );
  await expect(
    storeShare.getByRole("img", { name: `Código QR que abre ${storeOrigin()}/` }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Producto: enlace directo a su ficha.
  await page.goto(`${base}/productos/${productId}`);
  await page.getByText("Compartir este producto").click();
  const share = page.getByRole("region", { name: "Enlace directo y código QR" });
  const productUrl = `${storeOrigin()}/productos/${slug}`;
  await expect(share.getByLabel("Enlace")).toHaveValue(productUrl);
  const wa = await share.getByRole("link", { name: /Compartir por WhatsApp/ }).getAttribute("href");
  expect(decodeURIComponent(wa!.replace("https://wa.me/?text=", ""))).toBe(
    `Mira este producto: Café de olla 500 g\n${productUrl}`,
  );
  // Sin datos privados: ni el panel, ni identificadores internos, ni precios de costo.
  expect(wa).not.toContain("admin");
  expect(wa).not.toContain(productId);

  await share.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(share.getByRole("status")).toHaveText("Enlace copiado.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(productUrl);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    share.getByRole("button", { name: "Descargar QR" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`qr-${slug}.png`);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  // Ancho del PNG: (lado del QR + 8 de zona de silencio) × 12 px.
  expect((png.readUInt32BE(16) / 12 - 8 - 17) % 4).toBe(0);
  await expectNoSeriousA11yViolations(page);

  // Celular: nada se sale de la pantalla.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  await page.getByText("Compartir este producto").click();
  await expect(page.getByRole("img", { name: `Código QR que abre ${productUrl}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("el enlace compartido abre la ficha sin iniciar sesión", async ({ browser }) => {
  await admin`update public.stores set status = 'active', launched_at = coalesce(launched_at, now()) where id = ${tenant.storeId}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(`${storeOrigin()}/productos/${slug}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Café de olla 500 g" })).toBeVisible();
  await context.close();
});
