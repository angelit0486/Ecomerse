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
 * Fase 3 (misión 2026-10-17): la estructura de suplementos se crea con un clic,
 * no duplica lo que ya existe y desaparece cuando está completa.
 */
const run = uniq();
const ownerEmail = `taxonomia-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`tx${run}`, await createAuthUser(ownerEmail));
  // La dueña ya tenía «Creatina» (con otra dirección): no se vuelve a crear.
  await admin`insert into public.categories (store_id, name, slug) values (${tenant.storeId}, 'CREATINA', 'creatina-pura')`;
});

test("crear las categorías sugeridas que faltan y describir una", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/categorias`);
  const suggested = page.getByRole("region", { name: "¿Vendes suplementos? Estructura sugerida" });
  await expect(suggested.getByRole("listitem")).toHaveCount(7);
  await expect(suggested.getByText("Creatina", { exact: true })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  await suggested.getByRole("button", { name: "Crear las 7 categorías" }).click();
  // Completa la estructura, el recuadro desaparece y las categorías quedan en el árbol.
  await expect(
    page.getByRole("region", { name: "¿Vendes suplementos? Estructura sugerida" }),
  ).toHaveCount(0);
  const tree = page.getByRole("list", { name: "Árbol de categorías" });
  await expect(tree.locator("p", { hasText: "Preentrenos y energía" })).toBeVisible();

  const rows = await admin<{ name: string; slug: string }[]>`
    select name, slug from public.categories
     where store_id = ${tenant.storeId} and deleted_at is null and parent_id is null order by position, name`;
  expect(rows.map((r) => r.slug)).toEqual([
    "creatina-pura",
    "proteinas",
    "preentrenos-y-energia",
    "aminoacidos",
    "vitaminas-y-minerales",
    "salud-y-bienestar",
    "ganadores-de-masa",
    "accesorios-deportivos",
  ]);

  // La descripción se escribe en el panel (D-EST-03); la tienda ya la muestra.
  await page.goto(`/admin/${tenant.handle}/productos/categorias`);
  const row = page.getByRole("listitem").filter({ has: page.getByLabel("Nombre de CREATINA") });
  await row.getByText("Descripción en la tienda").click();
  await row.getByLabel("Descripción de CREATINA").fill("Monohidratada, sin sabor y con sabor.");
  await row.getByRole("button", { name: "Guardar" }).click();
  await expect(row.getByText("Categoría «CREATINA» actualizada.")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [cat] = await admin<{ description: string | null }[]>`
    select description from public.categories where store_id = ${tenant.storeId} and slug = 'creatina-pura'`;
  expect(cat?.description).toBe("Monohidratada, sin sabor y con sabor.");
});
