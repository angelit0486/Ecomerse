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
 * «Fotos en proceso» (Orden 09): tras importar un catálogo con fotos por
 * enlace, la tienda ve el avance y las fotos que no se pudieron usar, con su
 * motivo. Otra tienda no ve nada de esto.
 */
const run = uniq();
const ownerEmail = `fotos-duena-${run}@example.test`;
const otherEmail = `fotos-otra-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let other: Awaited<ReturnType<typeof createTenant>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`fp${run}`, ownerId);
  other = await createTenant(`fo${run}`, await createAuthUser(otherEmail));
  const [product] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug)
    values (${tenant.storeId}, 'Playera deportiva', 'playera-deportiva') returning id`;
  const media = (status: string, reason: string | null, url: string | null, n: number) => admin`
    insert into public.media (id, store_id, owner_type, product_id, status, rejection_reason, source_url,
                              storage_path, mime_type, bytes, position, width, height)
    select id, ${tenant.storeId}, 'product', ${product!.id}, ${status}, ${reason}, ${url},
           ${tenant.storeId} || '/product/' || ${product!.id} || '/' || id || '/original.jpg', 'image/jpeg', 1000,
           ${n}, ${status === "ready" ? 800 : null}, ${status === "ready" ? 800 : null}
      from (select gen_random_uuid() as id) x`;
  await media("ready", null, null, 0);
  await media("ready", null, null, 1);
  await media("ready", null, null, 2);
  await media(
    "rejected",
    "fetch_not_found",
    "https://fotos.example.test/a/playera.jpg?firma=secreta",
    3,
  );
});

test("la dueña ve el avance, la foto que no se pudo usar y cómo termina una en espera", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar/fotos`);
  await expect(page.getByRole("heading", { name: "Fotos en proceso" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("100 %");
  await expect(page.getByRole("status")).toContainText("3 fotos listas · 1 no se pudo usar.");
  await expect(page.getByText("No queda ninguna foto en espera.")).toBeVisible();

  const rejected = page.getByRole("region", { name: "Fotos que no se pudieron usar" });
  await expect(rejected.getByRole("link", { name: "Playera deportiva" })).toBeVisible();
  await expect(
    rejected.getByText("El enlace de la foto ya no existe o no lleva a una imagen."),
  ).toBeVisible();
  // El enlace se muestra sin su consulta: puede llevar una firma.
  await expect(rejected.getByText("fotos.example.test/a/playera.jpg")).toBeVisible();
  await expect(page.getByText("firma=secreta")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  // Una foto en espera sin archivo: la página arranca la cola y se actualiza sola.
  const [product] = await admin<{ id: string }[]>`
    select id from public.products where store_id = ${tenant.storeId} and slug = 'playera-deportiva'`;
  const [m] = await admin<{ id: string }[]>`
    insert into public.media (id, store_id, owner_type, product_id, status, storage_path, mime_type, bytes, position)
    select id, ${tenant.storeId}, 'product', ${product!.id}, 'pending',
           ${tenant.storeId} || '/product/' || ${product!.id} || '/' || id || '/original.jpg', 'image/jpeg', 1000, 4
      from (select gen_random_uuid() as id) x returning id`;
  await admin`select app.enqueue_job('media.process', ${admin.json({ media_id: m!.id })}, ${tenant.storeId},
                                     ${`media.process:${m!.id}`})`;
  await page.goto(`/admin/${tenant.handle}/productos/importar/fotos`);
  // La página arranca la cola y se actualiza sola.
  await expect(page.getByText("La subida no terminó. Inténtalo de nuevo.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("status")).toContainText("3 fotos listas · 2 no se pudieron usar.");
});

test("otra tienda no ve fotos ajenas ni puede abrir la página de esta", async ({ page }) => {
  await loginNewStaff(page, otherEmail);
  await page.goto(`/admin/${other.handle}/productos/importar/fotos`);
  await expect(page.getByRole("status")).toContainText("Tu tienda todavía no tiene fotos.");
  await expect(page.getByText("Playera deportiva")).toHaveCount(0);
  const foreign = await page.goto(`/admin/${tenant.handle}/productos/importar/fotos`);
  expect(foreign?.status()).toBe(404);
});
