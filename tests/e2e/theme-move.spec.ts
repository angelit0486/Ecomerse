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
 * ADR-034 §6: llevar el diseño entre tiendas. Copia el diseño publicado de otra
 * tienda de la misma organización, descarga el archivo y lo vuelve a subir;
 * todo cae en el borrador y nunca lleva imágenes ni filas de la tienda de origen.
 */
const run = uniq();
const ownerEmail = `mover-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let other: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`m${run}`, await createAuthUser(ownerEmail));
  other = await createTenant(`n${run}`, await createAuthUser(`otro-${run}@example.test`));
  const [sister] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${tenant.orgId}, 'Tienda hermana', ${`h${run}`}, 'MXN', 'MX', 'America/Mexico_City')
    returning id`;
  await admin`insert into public.store_themes (store_id, settings, home_sections) values (
    ${sister!.id},
    ${admin.json({ colors: { primary: "#8a2c55" }, typography: { heading: "lora" }, seo: { title: "Hermana" } })},
    ${admin.json([{ id: "00000000-0000-4000-8000-000000000001", type: "hero", enabled: true, props: { heading: "Diseño de la hermana", align: "center" } }])})`;
});

async function draft() {
  const [row] = await admin<
    { primary: string | null; heading: string | null; seo: string | null }[]
  >`
    select draft_settings #>> '{colors,primary}' as primary,
           draft_home_sections #>> '{0,props,heading}' as heading,
           draft_settings #>> '{seo,title}' as seo
      from public.store_themes where store_id = ${tenant.storeId}`;
  return row;
}

test("copiar de la tienda hermana, descargar y volver a subir el diseño", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=historial`);
  const section = page.getByRole("region", { name: "Llevar el diseño a otra tienda" });
  const select = section.getByLabel("Copiar el diseño publicado de otra tienda");
  // Solo tiendas de la misma organización.
  await expect(select.getByRole("option")).toHaveText(["Tienda hermana"]);
  expect(other.name).not.toBe("Tienda hermana");
  await expectNoSeriousA11yViolations(page);

  await section.getByRole("button", { name: "Copiar diseño de esta tienda" }).click();
  await expect(section.getByText("Diseño copiado al borrador.").first()).toBeVisible();
  expect(await draft()).toEqual({
    primary: "#8a2c55",
    heading: "Diseño de la hermana",
    seo: null,
  });

  // Descargar: el archivo lleva el formato y nada de la tienda.
  const response = await page.request.get(`/admin/${tenant.handle}/apariencia/exportar`);
  expect(response.status()).toBe(200);
  const file = (await response.json()) as {
    format: string;
    settings: { colors?: { primary?: string }; seo?: unknown };
  };
  expect(file.format).toBe("pruva-theme");
  expect(file.settings.seo).toBeUndefined();

  // Subirlo con otro color.
  file.settings.colors = { primary: "#0b2d5b" };
  await page.reload();
  await section.getByLabel("Subir un diseño descargado").setInputFiles({
    name: "diseno.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await section.getByRole("button", { name: "Copiar al borrador" }).click();
  await expect(section.getByText("Diseño copiado al borrador.").first()).toBeVisible();
  expect((await draft())?.primary).toBe("#0b2d5b");

  // Un archivo que no es un diseño se rechaza con un mensaje claro.
  await page.reload();
  await section.getByLabel("Subir un diseño descargado").setInputFiles({
    name: "otro.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await section.getByRole("button", { name: "Copiar al borrador" }).click();
  await expect(
    section.getByText("El archivo no es un diseño exportado desde el panel."),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});
