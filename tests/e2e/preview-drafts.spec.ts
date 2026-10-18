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
 * ADR-032: la dueña ve sus productos en borrador en la vista previa privada de su
 * tienda, marcados «Sin publicar» y sin botones de compra. Sus clientes no los
 * ven, ni siquiera después (la vista previa nunca llega a la caché pública).
 */
const run = uniq();
const ownerEmail = `borradores-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let draftId = "";
const store = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`bo${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [published] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Creatina publicada",
        slug: "creatina-publicada",
        variants: [{ sku: `CRE-${run}`, price: 49900, track_inventory: false }],
      })}) as r`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${published!.r.id})`;
    const [draft] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Proteína en borrador",
        slug: "proteina-en-borrador",
        variants: [
          { sku: `PRO-${run}`, price: 79900, compare_at_price: 99900, track_inventory: false },
        ],
      })}) as r`;
    draftId = draft!.r.id;
  });
});

test("los borradores solo se ven en la vista previa, marcados y sin compra", async ({
  page,
  browser,
}) => {
  // Un cliente: el borrador no existe.
  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(`${store()}/productos`);
  await expect(shopper.getByRole("heading", { name: "Creatina publicada" })).toBeVisible();
  await expect(shopper.getByText("Proteína en borrador")).toHaveCount(0);
  expect((await shopper.goto(`${store()}/productos/proteina-en-borrador`))?.status()).toBe(404);

  // La dueña: desde la ficha del panel abre la vista previa justo en ese producto.
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/${draftId}`);
  const [preview] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("link", { name: /Ver en la vista previa \(solo tú\)/ }).click(),
  ]);
  await preview.waitForURL(`${store()}/productos/proteina-en-borrador`);
  await expect(
    preview.getByRole("heading", { name: "Proteína en borrador", level: 1 }),
  ).toBeVisible();
  await expect(preview.getByRole("note")).toContainText(
    "Tus clientes no lo ven ni lo pueden comprar",
  );
  await expect(preview.getByRole("button", { name: "Agregar al carrito" })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "Comprar ahora" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(preview);

  // En el listado: la tarjeta del borrador marcada y sin «Agregar»; la publicada, con él.
  await preview.goto(`${store()}/productos`);
  const draftCard = preview.getByRole("article").filter({ hasText: "Proteína en borrador" });
  await expect(draftCard.getByText("Sin publicar")).toBeVisible();
  await expect(draftCard.getByRole("button", { name: /Agregar/ })).toHaveCount(0);
  const publishedCard = preview.getByRole("article").filter({ hasText: "Creatina publicada" });
  await expect(publishedCard.getByText("Sin publicar")).toHaveCount(0);
  await expect(publishedCard.getByRole("button", { name: /Agregar/ })).toBeVisible();

  // Lo que vio la dueña no llega a la caché pública.
  await shopper.goto(`${store()}/productos`);
  await expect(shopper.getByText("Proteína en borrador")).toHaveCount(0);
  await shopper.context().close();

  // Al salir de la vista previa, el borrador desaparece también para ella.
  await preview.getByRole("button", { name: "Salir de la vista previa" }).click();
  await preview.waitForURL(`${store()}/`);
  await preview.goto(`${store()}/productos`);
  await expect(preview.getByRole("heading", { name: "Creatina publicada" })).toBeVisible();
  await expect(preview.getByText("Proteína en borrador")).toHaveCount(0);
});
