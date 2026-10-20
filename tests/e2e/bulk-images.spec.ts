import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
 * Subida de fotos en lote: cada archivo va al producto cuyo SKU o nombre corto
 * coincide; los que no coinciden no se suben. Las fotos se aligeran en el
 * navegador y la cola se procesa al terminar, sin esperar al cron.
 */
const run = uniq();
const ownerEmail = `lote-duena-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const ids: Record<string, string> = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`bi${run}`, ownerId);
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    for (const [slug, title, sku] of [
      ["proteina-aislada", "Proteína aislada", `PRV-${run}`],
      ["creatina", "Creatina", `CRE-${run}`],
    ] as const) {
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
          title,
          slug,
          variants: [{ price: 50000, sku, inventory_policy: "continue" }],
        })}) as r`;
      ids[slug] = p!.r.id;
    }
    const [g] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Ganador de peso",
        slug: "ganador",
        options: [{ name: "Sabor", values: ["Vainilla", "Chocolate"] }],
        variants: [
          {
            price: 69900,
            sku: `GV-${run}`,
            options: { Sabor: "Vainilla" },
            inventory_policy: "continue",
          },
          {
            price: 69900,
            sku: `GC-${run}`,
            options: { Sabor: "Chocolate" },
            inventory_policy: "continue",
          },
        ],
      })}) as r`;
    ids.ganador = g!.r.id;
  });
});

async function photo(color: string, size = 3000) {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

test("fotos en lote por SKU y nombre, y varias a la vez en la ficha, sin esperar al cron", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  await page.getByRole("link", { name: "Sube sus fotos en lote" }).click();
  await expect(page.getByRole("heading", { name: "Subir imágenes en lote" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel(/^Fotos/).setInputFiles([
    { name: `PRV-${run}-2.jpg`, mimeType: "image/jpeg", buffer: await photo("#0b2d5b") },
    { name: `prv-${run}.jpg`, mimeType: "image/jpeg", buffer: await photo("#4f7ea8") },
    { name: "creatina.jpg", mimeType: "image/jpeg", buffer: await photo("#a7b8c6") },
    { name: `GC-${run}.jpg`, mimeType: "image/jpeg", buffer: await photo("#5b3a1e", 1200) },
    { name: "sin-producto.jpg", mimeType: "image/jpeg", buffer: await photo("#172638", 200) },
  ]);

  // Vista previa: nada se sube todavía.
  await expect(page.getByText(/4\s+fotos para\s+3\s+productos/)).toBeVisible();
  await expect(
    page.getByRole("row", { name: new RegExp(`GC-${run}\\.jpg.*foto del sabor GC-${run}`, "i") }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /sin-producto\.jpg.*Sin coincidencia/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /creatina\.jpg.*Creatina.*por nombre/ }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  const [before] = await admin<{ count: number }[]>`
    select count(*)::int as count from public.media where store_id = ${tenant.storeId}`;
  expect(before!.count).toBe(0);

  await page.getByRole("button", { name: "Subir 4 fotos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "4 fotos subidas" })).toBeVisible({
    timeout: 60_000,
  });
  // La foto nombrada con el SKU del sabor queda como la foto de ese sabor.
  await expect(
    page.getByRole("status").filter({ hasText: "Foto de sabor o tamaño asignada: 1 de 1." }),
  ).toBeVisible({ timeout: 60_000 });
  const variants = await admin<{ sku: string; has_image: boolean }[]>`
    select sku, image_id is not null as has_image from public.product_variants
     where product_id = ${ids.ganador!} order by sku`;
  expect(variants).toEqual([
    { sku: `GC-${run}`.toUpperCase(), has_image: true },
    { sku: `GV-${run}`.toUpperCase(), has_image: false },
  ]);
  // Lo ya subido no se puede volver a mandar: no hay botón que duplique fotos.
  await expect(page.getByRole("button", { name: /^(Subir|Reintentar)/ })).toHaveCount(0);

  // La pasada inmediata puede seguir optimizando cuando termina la subida: se
  // espera a que las tres estén listas (runJobs() es el respaldo idempotente).
  await expect
    .poll(
      async () => {
        await runJobs();
        const [row] = await admin<{ ready: number }[]>`
          select count(*)::int as ready from public.media
           where store_id = ${tenant.storeId} and status = 'ready'`;
        return row!.ready;
      },
      { timeout: 30_000 },
    )
    .toBe(4);
  const media = await admin<
    { product_id: string; position: number; status: string; width: number; mime_type: string }[]
  >`select product_id, position, status, width, mime_type from public.media
     where store_id = ${tenant.storeId} order by product_id, position`;
  expect(media).toHaveLength(4);
  expect(media.every((m) => m.status === "ready")).toBe(true);
  // Aligeradas en el navegador: 3000 px → como mucho 2400 px.
  expect(Math.max(...media.map((m) => m.width))).toBeLessThanOrEqual(2400);
  const aislada = media.filter((m) => m.product_id === ids["proteina-aislada"]);
  expect(aislada).toHaveLength(2);
  expect(media.filter((m) => m.product_id === ids.creatina)).toHaveLength(1);
  expect(media.filter((m) => m.product_id === ids.ganador)).toHaveLength(1);

  // La ficha: varias fotos a la vez, procesadas sin llamar al runner.
  await page.goto(`/admin/${tenant.handle}/productos/${ids.creatina!}`);
  await page.getByLabel("Agregar imágenes").setInputFiles(
    await Promise.all(
      ["#111111", "#222222", "#333333", "#444444", "#555555"].map(async (c, i) => ({
        name: `foto-${i}.jpg`,
        mimeType: "image/jpeg",
        buffer: await photo(c, 1600),
      })),
    ),
  );
  await expect(page.getByRole("status").filter({ hasText: "5 imágenes subidas" })).toBeVisible({
    timeout: 60_000,
  });
  // Sin llamar al runner: la cola se procesó tras la subida.
  await expect
    .poll(
      async () => {
        const [row] = await admin<{ pending: number }[]>`
          select count(*)::int as pending from public.media
           where product_id = ${ids.creatina!} and status = 'pending'`;
        return row!.pending;
      },
      { timeout: 30_000 },
    )
    .toBe(0);
  const rows = await admin<{ count: number }[]>`
    select count(*)::int as count from public.media where product_id = ${ids.creatina!} and status = 'ready'`;
  expect(rows[0]!.count).toBe(6);
});

test("carpeta por producto: las fotos van al producto de su carpeta, sin renombrarlas", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Una carpeta de catálogo como la de una tienda real: subcarpetas por SKU o nombre.
  const root = join(await mkdtemp(join(tmpdir(), "catalogo-")), "Catalogo");
  for (const [folder, file, color] of [
    [`PRV-${run}`, "IMG_2041.jpg", "#123456"],
    ["Ganador de peso", "frente.jpg", "#654321"],
    ["Ganador de peso", "lado.jpg", "#345612"],
    ["Varios", "logo.jpg", "#000000"],
  ] as const) {
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, folder, file), await photo(color, 800));
  }
  const before = await admin<{ product_id: string; n: number }[]>`
    select product_id, count(*)::int as n from public.media
     where store_id = ${tenant.storeId} and deleted_at is null group by product_id`;
  const count = (id: string) => before.find((r) => r.product_id === id)?.n ?? 0;

  // Otra persona del equipo (un segundo inicio de sesión de la dueña pediría el código 2FA).
  const helperEmail = `lote-carpeta-${run}@example.test`;
  const helperId = await createAuthUser(helperEmail);
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${tenant.orgId}, ${helperId}, 'org_member')`;
  await admin`insert into public.store_members (store_id, user_id, role_id)
              select ${tenant.storeId}, ${helperId}, r.id from public.roles r
               where r.key = 'store_admin' and r.organization_id is null`;
  await loginNewStaff(page, helperEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar/imagenes`);
  await page.locator("#bulk-folder-input").setInputFiles(root);

  await expect(page.getByText(/3\s+fotos para\s+2\s+productos/)).toBeVisible();
  await expect(page.getByRole("row", { name: /IMG_2041\.jpg.*por carpeta, SKU/ })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /lado\.jpg.*Ganador de peso.*por carpeta/ }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /logo\.jpg.*Sin coincidencia/ })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("button", { name: "Subir 3 fotos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 fotos subidas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(
      async () => {
        const rows = await admin<{ product_id: string; n: number }[]>`
          select product_id, count(*)::int as n from public.media
           where store_id = ${tenant.storeId} and deleted_at is null group by product_id`;
        const now = (id: string) => rows.find((r) => r.product_id === id)?.n ?? 0;
        return [
          now(ids["proteina-aislada"]!) - count(ids["proteina-aislada"]!),
          now(ids.ganador!) - count(ids.ganador!),
        ];
      },
      { timeout: 30_000 },
    )
    .toEqual([1, 2]);
});
