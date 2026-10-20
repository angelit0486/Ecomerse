import { expect, test } from "@playwright/test";
import sharp from "sharp";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * Misión panel, Fase 1: alta rápida desde el celular. Nombre, precio, fotos y
 * existencias; marca y categoría sugeridas por el nombre; borrador que no se
 * pierde al recargar; y lo que falta para publicar.
 */
const run = uniq();
const ownerEmail = `alta-rapida-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.use({ viewport: { width: 375, height: 812 } });

test.beforeAll(async () => {
  tenant = await createTenant(`ar${run}`, await createAuthUser(ownerEmail));
  await admin`insert into public.brands (store_id, name, slug)
              values (${tenant.storeId}, 'Optimum Nutrition', 'optimum-nutrition'),
                     (${tenant.storeId}, 'Dymatize', 'dymatize')`;
  await admin`insert into public.categories (store_id, name, slug)
              values (${tenant.storeId}, 'Proteínas', 'proteinas'),
                     (${tenant.storeId}, 'Creatinas', 'creatinas')`;
});

async function photo(color: string) {
  return sharp({ create: { width: 900, height: 900, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

test("alta rápida en el celular: sugerencias, borrador, fotos en orden y existencias", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}/productos`;
  await page.goto(`${base}/nuevo`);
  await expect(page.getByRole("heading", { name: "Nuevo producto" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Lo que se escribe se guarda en el dispositivo: al recargar se recupera.
  await page.getByRole("radio", { name: "Suplemento" }).check({ force: true });
  await page
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Proteína Gold Standard Optimum Nutrition 2 lb");
  await page.getByRole("textbox", { name: "Precio", exact: true }).fill("$1,299.50");
  await page.reload();
  await page.getByRole("button", { name: "Recuperarlo" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue(
    "Proteína Gold Standard Optimum Nutrition 2 lb",
  );

  // Marca y categoría sugeridas por el nombre (ella puede cambiarlas).
  await page.getByText(/Más datos \(opcional\)/).click();
  await expect(page.getByRole("combobox", { name: "Marca" })).toHaveValue(
    (
      await admin<
        { id: string }[]
      >`select id from public.brands where store_id = ${tenant.storeId} and slug = 'optimum-nutrition'`
    )[0]!.id,
  );
  await expect(page.getByText("Sugerida por el nombre: Proteínas.")).toBeVisible();
  await page.getByRole("combobox", { name: "Contenido neto" }).fill("907 g");
  await page.getByRole("textbox", { name: "Porciones por envase" }).fill("30");
  await page.getByRole("textbox", { name: "Existencias" }).fill("12");
  await expect(page.getByText(/Para publicarlo te falta: al menos una foto/)).toBeVisible();

  // Dos fotos; la segunda pasa a ser la principal.
  await page.getByLabel("Agregar fotos").setInputFiles([
    { name: "frente.jpg", mimeType: "image/jpeg", buffer: await photo("#0b2d5b") },
    { name: "etiqueta.jpg", mimeType: "image/jpeg", buffer: await photo("#a7b8c6") },
  ]);
  await page.getByRole("button", { name: "Mover la foto 2 antes" }).click();
  await expect(page.getByRole("img", { name: "Foto 1 (principal)" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Sin desborde horizontal en el celular.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Un precio mal escrito se explica en español y no borra lo capturado.
  await page.getByRole("textbox", { name: "Precio", exact: true }).fill("mil pesos");
  await page.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.getByText("Escribe un precio como 499 o 499.50.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto 1 (principal)" })).toBeVisible();
  await page.getByRole("textbox", { name: "Precio", exact: true }).fill("1299.50");

  await page.getByRole("button", { name: "Crear producto" }).click();
  await expect(page).toHaveURL(/\/productos\/[0-9a-f-]{36}\?creado=1/, { timeout: 60_000 });

  const [product] = await admin<
    { id: string; status: string; brand: string; category: string | null }[]
  >`select p.id, p.status, b.name as brand,
           (select c.name from public.product_categories pc join public.categories c on c.id = pc.category_id
             where pc.product_id = p.id and pc.is_primary) as category
      from public.products p join public.brands b on b.id = p.brand_id
     where p.store_id = ${tenant.storeId} and p.title = 'Proteína Gold Standard Optimum Nutrition 2 lb'`;
  expect(product).toMatchObject({
    status: "draft",
    brand: "Optimum Nutrition",
    category: "Proteínas",
  });
  const [variant] = await admin<
    { price: string; net_content: string; servings_per_container: number; on_hand: number }[]
  >`select v.price, v.net_content, v.servings_per_container,
           (select sum(l.on_hand)::int from public.inventory_levels l where l.variant_id = v.id) as on_hand
      from public.product_variants v where v.product_id = ${product!.id}`;
  expect(variant).toMatchObject({
    price: "129950",
    net_content: "907 g",
    servings_per_container: 30,
    on_hand: 12,
  });
  // Las dos fotos subidas y el borrador local ya no se ofrece.
  const media = await admin<{ position: number }[]>`
    select position from public.media where product_id = ${product!.id} order by position`;
  expect(media).toHaveLength(2);
  await page.goto(`${base}/nuevo`);
  await expect(page.getByRole("button", { name: "Recuperarlo" })).toHaveCount(0);
});
