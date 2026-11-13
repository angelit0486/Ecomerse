import { expect, test, type Page } from "@playwright/test";

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
 * ADR-064 opción A por la interfaz (Orden 10, mensaje 4): un archivo de 18,000
 * filas se parte EN EL NAVEGADOR y se sube por partes; el lote se aplica en orden;
 * la parte 3 falla al aplicarse y el panel lo dice parte por parte; el comerciante
 * corrige su archivo, lo vuelve a elegir (solo sube la parte 3) y el lote termina.
 * Aparte: una subida cortada se retoma eligiendo el mismo archivo, y un lote sin
 * aplicar se cancela.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `lote-${run}@example.test`;
// Cada prueba con su usuario: un segundo inicio de sesión del mismo usuario ya no
// registra la verificación en dos pasos (la pide).
const resumeEmail = `retomar-${run}@example.test`;
let ownerId = "";
let tenant: Awaited<ReturnType<typeof createTenant>>;
let resumeTenant: Awaited<ReturnType<typeof createTenant>>;
/** Capturas para el informe, solo con E2E_EVIDENCIA_DIR (fuera de CI). */
const evidence = process.env.E2E_EVIDENCIA_DIR;

const SIZES = ["CH", "M", "G"];

/** Hoja de ropa: `products` playeras en 3 tallas, «Publicado: sí»; cada 500, precio 0. */
function sheet(products: number, fix?: { sku: string; to: string }) {
  const lines = ["Producto,Talla,Precio,Existencias,SKU,Publicado"];
  for (let i = 1; i <= products; i += 1) {
    for (const size of SIZES) {
      const sku = `PL-${i}-${size}`;
      lines.push(
        `Playera ${i},${size},${i % 500 === 0 ? "0" : "249.00"},${(i % 9) + 1},${fix?.sku === sku ? fix.to : sku},sí`,
      );
    }
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`);
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`lt${run}`, ownerId);
  // 6,000 productos: más que el plan E2E por omisión.
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('e2e_lote', 'e2e_lote')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 20),
                     (${plan!.id}, 'max_products', 20000), (${plan!.id}, 'storage_mb', 1000)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  await admin`update public.subscriptions set plan_id = ${plan!.id} where organization_id = ${tenant.orgId}`;
  resumeTenant = await createTenant(`lr${run}`, await createAuthUser(resumeEmail));
});

async function capture(page: Page, name: string) {
  if (evidence) await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}

const parts = (page: Page) => page.getByRole("list", { name: "Partes" }).getByRole("listitem");

/** Corre la cola (como el cron) hasta que la página muestre `text`. */
async function untilVisible(page: Page, text: RegExp | string, timeout = 480_000) {
  await expect(async () => {
    await runJobs();
    await page.reload();
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout, intervals: [1_000, 2_000, 3_000] });
}

test("18,000 filas por partes: falla la parte 3, se corrige solo esa y el lote termina", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  await page
    .getByLabel(/^Archivo CSV de esta plataforma/)
    .setInputFiles({ name: "ropa-18k.csv", mimeType: "text/csv", buffer: sheet(6000) });
  await page.getByRole("button", { name: "Validar archivo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "se sube en 4 partes" })).toBeVisible({
    timeout: 30_000,
  });
  // Al terminar de subir, abre el lote: 4 partes revisadas, ninguna aplicada.
  await expect(page.getByRole("heading", { name: "ropa-18k.csv" })).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByText("18,000 filas en 4 partes")).toBeVisible();
  await expect(parts(page)).toHaveCount(4);
  for (const i of [0, 1, 2]) {
    await expect(parts(page).nth(i)).toContainText("4,998 filas");
    await expect(parts(page).nth(i)).toContainText("Lista: 1,666 por crear");
  }
  await expect(parts(page).nth(3)).toContainText("3,006 filas");
  await expectNoSeriousA11yViolations(page);
  await capture(page, "lote-18k-1-listo");

  // Entre la vista previa y la aplicación alguien usa en el panel el SKU de la
  // última fila de la parte 3: esa parte fallará al aplicarse.
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true),
                     set_config('role', 'authenticated', true)`;
    await sql`select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
      title: "Intruso",
      slug: "intruso",
      variants: [{ price: 100, sku: "PL-4998-G" }],
    })})`;
  });

  await page.getByRole("button", { name: "Aplicar el lote" }).click();
  await untilVisible(page, "El lote se detuvo.");
  await expect(page.getByText(/La parte 3 no se pudo aplicar: Fila 14995/)).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Lote aplicado a medias.");
  await expect(page.getByRole("note")).toContainText("Las partes 1 y 2 ya están en tu catálogo");
  await expect(parts(page).nth(0)).toContainText("Aplicada");
  await expect(parts(page).nth(1)).toContainText("Aplicada");
  await expect(parts(page).nth(2)).toContainText("Error");
  await expect(parts(page).nth(2)).toContainText("no dejó ningún cambio");
  await expect(parts(page).nth(3)).toContainText("Pendiente");
  await expectNoSeriousA11yViolations(page);
  await capture(page, "lote-18k-2-detenido-a-medias");
  const [partial] = await admin<{ p3: number; p4: number; p12: number }[]>`
    select count(*) filter (where n between 3333 and 4998)::int as p3,
           count(*) filter (where n > 4998)::int as p4,
           count(*) filter (where n <= 3332)::int as p12
      from (select substring(slug from 9)::int as n from public.products
             where store_id = ${tenant.storeId} and slug ~ '^playera-[0-9]+$') x`;
  expect(partial).toEqual({ p3: 0, p4: 0, p12: 3332 });

  // Corrige el SKU en su archivo y lo vuelve a elegir: solo se sube la parte 3.
  await page.getByLabel("Archivo CSV", { exact: true }).setInputFiles({
    name: "ropa-18k.csv",
    mimeType: "text/csv",
    buffer: sheet(6000, { sku: "PL-4998-G", to: "PL-4998-G2" }),
  });
  await page.getByRole("button", { name: "Revisar y subir" }).click();
  await expect(page.getByText("Se subió la parte 3.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("status").filter({ hasText: "ya no tiene errores" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar con la parte 3" }).click();
  await untilVisible(page, /^Lote terminado/);
  for (const i of [0, 1, 2, 3]) await expect(parts(page).nth(i)).toContainText("Aplicada");

  // Publicación masiva de los marcados «sí»: solo los que cumplen.
  await untilVisible(page, "5,988 publicados.", 300_000);
  const summary = page.getByRole("region", { name: "Publicación" });
  await expect(summary.getByRole("status")).toContainText("12 pendientes: 12 con precio inválido.");
  await expect(summary.getByRole("list", { name: "Productos sin publicar" })).toContainText(
    "Playera 500",
  );
  await expectNoSeriousA11yViolations(page);
  await capture(page, "lote-18k-3-terminado-y-publicado");

  // Sin duplicados: 6,000 productos y 18,000 presentaciones, cada SKU una vez.
  const [counts] = await admin<{ products: number; variants: number; skus: number }[]>`
    select count(distinct p.id)::int as products, count(v.id)::int as variants,
           count(distinct v.sku)::int as skus
      from public.products p
      join public.product_variants v on v.store_id = p.store_id and v.product_id = p.id
     where p.store_id = ${tenant.storeId} and p.slug ~ '^playera-[0-9]+$'`;
  expect(counts).toEqual({ products: 6000, variants: 18000, skus: 18000 });
});

test("una subida cortada se retoma eligiendo el mismo archivo; un lote sin aplicar se cancela", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await loginNewStaff(page, resumeEmail);
  await page.goto(`/admin/${resumeTenant.handle}/productos/importar`);
  const file = { name: "retomar.csv", mimeType: "text/csv", buffer: sheet(3500) };
  // Se corta la conexión al subir la parte 2.
  await page.route("**/lote/*/parte/2", (route) => route.abort("failed"));
  await page.getByLabel(/^Archivo CSV de esta plataforma/).setInputFiles(file);
  await page.getByRole("button", { name: "Validar archivo" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Se cortó la conexión" })).toContainText(
    "Se cortó la conexión al subir la parte 2",
    {
      timeout: 120_000,
    },
  );
  await page.unroute("**/lote/*/parte/2");

  // De vuelta en Importar: el lote sin terminar está a la vista.
  await page.goto(`/admin/${resumeTenant.handle}/productos/importar`);
  await expect(
    page
      .getByRole("region", { name: "Importaciones por partes sin terminar" })
      .getByRole("link", { name: "retomar.csv" }),
  ).toBeVisible();
  // Elige el mismo archivo: se retoma el mismo lote y la parte 1 no se vuelve a subir.
  await page.getByLabel(/^Archivo CSV de esta plataforma/).setInputFiles(file);
  await page.getByRole("button", { name: "Validar archivo" }).click();
  await expect(page.getByRole("heading", { name: "retomar.csv" })).toBeVisible({
    timeout: 180_000,
  });
  await expect(parts(page)).toHaveCount(3);
  for (const i of [0, 1, 2]) await expect(parts(page).nth(i)).toContainText("Pendiente");
  const batches = await admin<{ id: string }[]>`
    select id from public.import_batches where store_id = ${resumeTenant.storeId} and file_name = 'retomar.csv'`;
  expect(batches).toHaveLength(1);
  const [part1] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.import_jobs where batch_id = ${batches[0]!.id} and part_number = 1`;
  expect(part1!.n).toBe(1);

  // Cancelar: nada se aplicó, nada cambia.
  await page.getByText("Cancelar el lote", { exact: true }).click();
  await page.getByRole("button", { name: "Sí, cancelar el lote" }).click();
  await expect(page.getByText("Lote cancelado: no se aplicó ninguna parte.")).toBeVisible();
  for (const i of [0, 1, 2]) await expect(parts(page).nth(i)).toContainText("Cancelada");
  await expectNoSeriousA11yViolations(page);
  const [applied] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.import_jobs
     where batch_id = ${batches[0]!.id} and status <> 'cancelled'`;
  expect(applied!.n).toBe(0);
});
