import { expect, test, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  enterEmailCode,
  expectNoSeriousA11yViolations,
  freshTotp,
  loginNewStaff,
  uniq,
  asFreshClient,
} from "./support";

/**
 * R-T04 (ADR-022): la dueña define "Objetivo" y "Sabor", los asigna en sus
 * productos y la tienda filtra con conteo por valor (OR dentro de un atributo,
 * AND entre atributos). Otra tienda no ve nada de esto.
 */
const run = uniq();
const ownerEmail = `atributos-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let other: Awaited<ReturnType<typeof createTenant>>;
const products: Record<string, string> = {};
let ownerSecret = "";

const store = () => `http://${tenant.handle}.localhost:3000`;

async function loginAgain(page: Page, email: string, secret: string) {
  const sentAt = Date.now() - 1000;
  await asFreshClient(page);
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await enterEmailCode(page, email, sentAt);
  await page.getByLabel("Código de la app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Títulos de las tarjetas del listado. */
async function cardTitles(page: Page): Promise<string[]> {
  const titles = await page
    .getByRole("region", { name: "Productos" })
    .getByRole("heading", { level: 3 })
    .allTextContents();
  return titles.sort();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`a${run}`, ownerId);
  const otherOwner = await createAuthUser(`otra-${run}@example.test`);
  other = await createTenant(`o${run}`, otherOwner);
  await admin`update public.stores set status = 'active', launched_at = now()
               where id in (${tenant.storeId}, ${other.storeId})`;
  const publish = async (owner: string, storeId: string, title: string, price: number) =>
    admin.begin(async (sql) => {
      await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated", aal: "aal2" })}, true)`;
      await sql`set local role authenticated`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${storeId}, ${sql.json({
          title,
          variants: [{ price }],
        })}) as r`;
      await sql`select public.catalog_publish_product(${storeId}, ${p!.r.id})`;
      return p!.r.id;
    });
  products.choco = await publish(ownerId, tenant.storeId, "Proteína Choco", 59900);
  products.vainilla = await publish(ownerId, tenant.storeId, "Proteína Vainilla", 49900);
  products.cafeina = await publish(ownerId, tenant.storeId, "Cafeína", 19900);
  await publish(otherOwner, other.storeId, "Proteína ajena", 39900);
});

test("la dueña define atributos y los asigna en el producto", async ({ page }) => {
  ownerSecret = await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos`);
  await page.getByText("Más del catálogo").click();
  await page.getByRole("link", { name: "Atributos" }).click();
  await expect(page.getByRole("heading", { name: "Atributos", level: 1 })).toBeVisible();

  const create = async (name: string, values: string[]) => {
    const form = page.getByRole("form", { name: "Nuevo atributo" });
    await form.getByLabel("Nombre del atributo").fill(name);
    for (const [i, value] of values.entries()) {
      if (i >= 2)
        await form.getByRole("button", { name: "Agregar un valor a Nuevo atributo" }).click();
      await form.getByLabel(`Valor ${i + 1} de Nuevo atributo`, { exact: true }).fill(value);
    }
    await form.getByRole("button", { name: "Crear atributo" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Atributo guardado." })).toBeVisible();
    await expect(page.getByRole("form", { name: `Atributo ${name}` })).toBeVisible();
  };
  await create("Objetivo", ["Energía", "Masa muscular", "Recuperación"]);
  await create("Sabor", ["Chocolate", "Vainilla"]);
  await expect(page.getByText("En la URL: ?objetivo=…")).toBeVisible();

  // Un valor repetido se marca sin perder lo escrito.
  const repeated = page.getByRole("form", { name: "Nuevo atributo" });
  await repeated.getByLabel("Nombre del atributo").fill("Presentación");
  await repeated.getByLabel("Valor 1 de Nuevo atributo", { exact: true }).fill("Polvo");
  await repeated.getByLabel("Valor 2 de Nuevo atributo", { exact: true }).fill("polvo");
  await repeated.getByRole("button", { name: "Crear atributo" }).click();
  await expect(repeated.getByRole("alert")).toHaveText("«polvo» está repetido.");
  await expect(repeated.getByLabel("Nombre del atributo")).toHaveValue("Presentación");
  await expectNoSeriousA11yViolations(page);

  await page.goto(`/admin/${tenant.handle}/productos/${products.choco}`);
  const section = page.getByRole("region", { name: "Atributos" });
  await section.getByRole("checkbox", { name: "Masa muscular" }).check();
  await section.getByRole("checkbox", { name: "Recuperación" }).check();
  await section.getByRole("checkbox", { name: "Chocolate" }).check();
  await section.getByRole("button", { name: "Guardar atributos" }).click();
  await expect(
    section.getByRole("status").filter({ hasText: "Atributos guardados." }),
  ).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "Chocolate" })).toBeChecked();
  await expectNoSeriousA11yViolations(page);

  // Los otros dos, directo con la RPC (lo mismo que hace el formulario).
  const values = await admin<{ key: string; id: string }[]>`
    select a.key || ':' || av.key as key, av.id from public.attribute_values av
      join public.attributes a on a.id = av.attribute_id where a.store_id = ${tenant.storeId}`;
  const id = (key: string) => values.find((v) => v.key === key)!.id;
  const [owner] = await admin<{ user_id: string }[]>`
    select user_id from public.organization_members where organization_id = ${tenant.orgId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner!.user_id, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.catalog_set_product_attributes(${tenant.storeId}, ${products.vainilla!},
                ${[id("objetivo:masa-muscular"), id("sabor:vainilla")]}::uuid[])`;
    await sql`select public.catalog_set_product_attributes(${tenant.storeId}, ${products.cafeina!},
                ${[id("objetivo:energia")]}::uuid[])`;
  });
});

test("la tienda filtra con conteo por valor y conserva el orden", async ({ page }) => {
  await page.goto(`${store()}/productos`);
  const filters = page.getByRole("form", { name: "Filtros" });
  const objetivo = filters.getByRole("group", { name: "Objetivo" });
  await expect(objetivo.getByRole("checkbox", { name: "Masa muscular (2)" })).toBeVisible();
  await expect(objetivo.getByRole("checkbox", { name: "Energía (1)" })).toBeVisible();
  await expect
    .poll(() => cardTitles(page))
    .toEqual(["Cafeína", "Proteína Choco", "Proteína Vainilla"]);

  // OR dentro de un atributo. Con JavaScript cada casilla se aplica sola (revisión
  // de conversión, M6): el botón «Filtrar» queda solo para quien navega sin JS.
  await expect(filters.getByRole("button", { name: "Filtrar" })).toBeHidden();
  await objetivo.getByRole("checkbox", { name: /Masa muscular/ }).check();
  await expect(page).toHaveURL(/objetivo=masa-muscular/);
  await objetivo.getByRole("checkbox", { name: /Energía/ }).check();
  await expect(page).toHaveURL(/objetivo=energia/);
  await expect
    .poll(() => cardTitles(page))
    .toEqual(["Cafeína", "Proteína Choco", "Proteína Vainilla"]);

  // AND entre atributos; los conteos de Sabor ya cuentan con el objetivo elegido.
  await page.goto(`${store()}/productos?objetivo=masa-muscular`);
  await expect.poll(() => cardTitles(page)).toEqual(["Proteína Choco", "Proteína Vainilla"]);
  const sabor = page.getByRole("form", { name: "Filtros" }).getByRole("group", { name: "Sabor" });
  await expect(sabor.getByRole("checkbox", { name: "Chocolate (1)" })).toBeVisible();
  await sabor.getByRole("checkbox", { name: /Chocolate/ }).check();
  await expect(page).toHaveURL(/sabor=chocolate/);
  await expect.poll(() => cardTitles(page)).toEqual(["Proteína Choco"]);
  await expectNoSeriousA11yViolations(page);

  // Ordenar no pierde los filtros.
  await page.getByLabel("Ordenar por").selectOption("price_asc");
  await expect(page).toHaveURL(/orden=price_asc/);
  await expect(page).toHaveURL(/objetivo=masa-muscular/);
  await expect.poll(() => cardTitles(page)).toEqual(["Proteína Choco"]);

  // Quitar un filtro activo, luego todos.
  await page
    .getByRole("navigation", { name: "Filtros activos" })
    .getByRole("link", { name: "Quitar el filtro Sabor: Chocolate" })
    .click();
  await expect.poll(() => cardTitles(page)).toEqual(["Proteína Choco", "Proteína Vainilla"]);
  // La casilla se desmarca sola: marcar otra no devuelve el filtro quitado (revisión adversarial).
  await expect(sabor.getByRole("checkbox", { name: /Chocolate/ })).not.toBeChecked();
  await sabor.getByRole("checkbox", { name: /Vainilla/ }).check();
  await expect(page).toHaveURL(/sabor=vainilla/);
  await expect(page).not.toHaveURL(/sabor=chocolate/);
  await page.goBack();
  await page.getByRole("link", { name: "Quitar filtros" }).click();
  await expect
    .poll(() => cardTitles(page))
    .toEqual(["Cafeína", "Proteína Choco", "Proteína Vainilla"]);
  await expect(page).toHaveURL(/orden=price_asc/);

  // Sin productos con esa combinación: lo dice y ofrece quitar los filtros.
  await page.goto(`${store()}/productos?objetivo=energia&sabor=chocolate`);
  await expect(
    page.getByRole("heading", { name: "Ningún producto coincide con estos filtros" }),
  ).toBeVisible();

  // La ficha muestra los atributos como datos (no parecen selectores, revisión
  // de conversión M4) y solo el objetivo lleva al catálogo filtrado.
  await page.goto(`${store()}/productos`);
  await page.getByRole("heading", { name: "Proteína Choco", level: 3 }).click();
  await expect(page.getByRole("definition").filter({ hasText: "Chocolate" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Chocolate/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Ver más para Masa muscular" }).click();
  await expect(page).toHaveURL(/\/productos\?objetivo=masa-muscular$/);
  await expect.poll(() => cardTitles(page)).toEqual(["Proteína Choco", "Proteína Vainilla"]);

  // Otra tienda: sin filtros de atributo (solo el de precio, que toda tienda
  // tiene), y un filtro de la URL no le aplica.
  await page.goto(`http://${other.handle}.localhost:3000/productos?objetivo=masa-muscular`);
  const otherFilters = page.getByRole("form", { name: "Filtros" });
  await expect(otherFilters.getByRole("group", { name: "Precio" })).toBeVisible();
  await expect(otherFilters.getByRole("group", { name: "Objetivo" })).toHaveCount(0);
  await expect.poll(() => cardTitles(page)).toEqual(["Proteína ajena"]);
});

test("renombrar un valor se ve al instante en la tienda", async ({ page }) => {
  // El listado sin filtros quedó en la caché de datos (TTL 60 s): guardar la invalida.
  await loginAgain(page, ownerEmail, ownerSecret);
  await page.goto(`/admin/${tenant.handle}/productos/atributos`);
  const form = page.getByRole("form", { name: "Atributo Objetivo" });
  await form.getByLabel("Valor 1 de Objetivo", { exact: true }).fill("Energía y enfoque");
  await form.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Atributo guardado." })).toBeVisible();

  await page.goto(`${store()}/productos`);
  const objetivo = page
    .getByRole("form", { name: "Filtros" })
    .getByRole("group", { name: "Objetivo" });
  await expect(objetivo.getByRole("checkbox", { name: "Energía y enfoque (1)" })).toBeVisible();
  // La clave de la URL no cambió al renombrar.
  await page.goto(`${store()}/productos?objetivo=energia`);
  await expect.poll(() => cardTitles(page)).toEqual(["Cafeína"]);
});
