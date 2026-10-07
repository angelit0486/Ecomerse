import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { admin, createAuthUser, createTenant, loginNewStaff, uniq } from "./support";

/** F8-T04a: exportación CSV con neutralización de fórmulas y auditoría. */
const run = uniq();
const ownerEmail = `exportar-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`ex${run}`, await createAuthUser(ownerEmail));
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status)
    values (${tenant.storeId}, '=HYPERLINK("http://malo.test","clic")', 'formula', 'draft') returning id`;
  await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature)
              values (${tenant.storeId}, ${p!.id}, ${`EX-${run.toUpperCase()}`}, 12345, '')`;
});

test("exportar productos: CSV descargable, fórmulas neutralizadas y registro en Actividad", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Exportar" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Descargar productos" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${tenant.handle}-products-\\d{4}-\\d{2}-\\d{2}\\.csv$`),
  );
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.startsWith("﻿handle,title,status")).toBe(true);
  expect(csv).toContain(`"'=HYPERLINK(""http://malo.test"",""clic"")"`);
  expect(csv).toContain(`EX-${run.toUpperCase()}`); // fila de la variante
  expect(csv).toContain("123.45");

  // Otro origen no puede disparar la descarga (además de SameSite=Lax).
  const forged = await page.request.post(`/admin/${tenant.handle}/ajustes/exportar/products`, {
    headers: { origin: "http://malo.test" },
  });
  expect(forged.status()).toBe(403);

  await page.goto(`/admin/${tenant.handle}/ajustes/actividad`);
  await expect(page.getByText("Descargó una exportación")).toBeVisible();
});
