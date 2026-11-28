import { expect, test, type Page } from "@playwright/test";

import { readFile } from "node:fs/promises";

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
 * RM-12 (2026-11-28, docs/audit/RM-12-revisor-archivo.md): todos los errores de
 * un archivo en un solo reporte.
 * C1: el CSV de errores de una importación no se corta en las 1,000 filas que
 *     PostgREST entrega por consulta (max_rows).
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `reporte-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

const HEADER = "handle,title,status,sku,price,inventory_quantity";

/** `rows` productos; los que cumplen `bad(i)` llevan un precio que no es importe. */
function sheet(rows: number, bad: (i: number) => boolean) {
  const lines = [HEADER];
  for (let i = 1; i <= rows; i += 1) {
    lines.push(`rep-${i},Producto ${i},draft,REP-${i},${bad(i) ? "abc" : "120.00"},${i % 7}`);
  }
  return Buffer.from(`${lines.join("\n")}\n`);
}

/** Corre la cola (como el cron) hasta que la página muestre `text`. */
async function untilVisible(page: Page, text: RegExp | string, timeout = 240_000) {
  await expect(async () => {
    await runJobs();
    await page.reload();
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout, intervals: [1_000, 2_000, 3_000] });
}

/** Filas de datos de un CSV (sin el encabezado ni la línea final vacía). */
const dataLines = (csv: string) =>
  csv
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/)
    .slice(1);

test.beforeAll(async () => {
  tenant = await createTenant(`rp${run}`, await createAuthUser(ownerEmail));
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('e2e_reporte', 'e2e_reporte')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 20),
                     (${plan!.id}, 'max_products', 20000), (${plan!.id}, 'storage_mb', 1000)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  await admin`update public.subscriptions set plan_id = ${plan!.id} where organization_id = ${tenant.orgId}`;
});

test("C1: el CSV de errores trae las 1,500 filas con error, no solo 1,000", async ({ page }) => {
  test.setTimeout(600_000);
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  // 2,000 filas, 1,500 con error (las que no son múltiplo de 4).
  await page.getByLabel(/^Archivo CSV de esta plataforma/).setInputFiles({
    name: "muchos-errores.csv",
    mimeType: "text/csv",
    buffer: sheet(2000, (i) => i % 4 !== 0),
  });
  await page.getByRole("button", { name: "Validar archivo" }).click();
  await expect(page.getByRole("heading", { name: "muchos-errores.csv" })).toBeVisible({
    timeout: 120_000,
  });
  await untilVisible(page, "Descargar las filas con error (CSV)");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Descargar las filas con error (CSV)" }).click(),
  ]);
  const csv = await readFile((await download.path())!, "utf8");
  const lines = dataLines(csv);
  expect(csv).toContain("fila,errores,handle");
  expect(lines).toHaveLength(1500);
  // En orden de fila: la primera es la fila 2 (rep-1) y la última la 2001 (rep-1999).
  expect(lines[0]).toMatch(/^2,/);
  expect(lines.at(-1)).toMatch(/^2000,.*rep-1999/);
  await expectNoSeriousA11yViolations(page);
});
