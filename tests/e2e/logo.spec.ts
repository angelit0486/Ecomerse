import { expect, test } from "@playwright/test";
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
 * F3-T06: el logo pasa por el pipeline seguro de medios (sin EXIF, re-codificado),
 * se elige en el borrador del branding y, publicado, aparece en la tienda.
 */
const run = uniq();
const ownerEmail = `logo-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`l${run}`, await createAuthUser(ownerEmail));
});

test("logo: subir → procesar → usar en el borrador → visible en la tienda publicada", async ({
  page,
  context,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/configuracion`);
  await expect(page.getByText("Tu tienda aún no tiene logo")).toBeVisible();

  // Un SVG no llega ni a pedir la URL de subida.
  await page.getByLabel("Subir logo").setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
  });
  await expect(page.getByRole("alert").filter({ hasText: "hasta 2 MB" })).toBeVisible();

  const png = await sharp({
    create: { width: 400, height: 120, channels: 4, background: "#0055aa" },
  })
    .withExif({ IFD0: { Artist: "Diseñadora" } })
    .png()
    .toBuffer();
  await page
    .getByLabel("Subir logo")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Procesando el logo…")).toBeVisible();
  await runJobs();
  await page.getByRole("button", { name: "Usar este logo" }).click({ timeout: 15_000 });
  await expect(
    page.getByRole("status").filter({ hasText: "Logo guardado en el borrador." }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: `Logo de ${tenant.name}` })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [theme] = await admin<{ draft_logo_media_id: string | null }[]>`
    select draft_logo_media_id from public.store_themes where store_id = ${tenant.storeId}`;
  expect(theme?.draft_logo_media_id).not.toBeNull();

  // Publicar el tema (RPC cubierta por pgTAP; el editor de apariencia llega en la Fase 5).
  await admin`update public.store_themes set logo_media_id = draft_logo_media_id where store_id = ${tenant.storeId}`;
  const [preview] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Ver vista previa de la tienda" }).click(),
  ]);
  await preview.waitForLoadState();
  const logo = preview.getByRole("img", { name: tenant.name });
  await expect(logo).toBeVisible();
  const src = await logo.getAttribute("src");
  expect(src).toContain("/storage/v1/object/public/store-media/");
  const served = Buffer.from(await (await fetch(src!)).arrayBuffer());
  expect((await sharp(served).metadata()).exif).toBeUndefined();
});
