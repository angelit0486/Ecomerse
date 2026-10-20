import { expect, test } from "@playwright/test";

import { admin, createAuthUser, createTenant, loginNewStaff, uniq } from "./support";

/**
 * Recorrido fijo del panel (plan del panel, A4): abre cada pantalla alcanzable
 * desde el menú y sus enlaces, y falla si alguna da error del servidor, página
 * de error o excepción en el navegador. Además cubre el estado del sistema en
 * Inicio (A2) y el aviso de importación repetida (A3).
 */
const run = uniq();
const ownerEmail = `recorrido-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
const jobs: Record<string, string> = {};

// Avisos conocidos sin efecto visible: Radix Select y Toast ponen estilos en
// línea que la CSP con nonce rechaza antes de hidratar (docs/DECISIONS.md §18).
const KNOWN_CONSOLE = /Refused to apply inline style/;

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`rp${run}`, ownerId);
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    await sql`select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
      title: "Proteína de recorrido",
      slug: "proteina-recorrido",
      variants: [{ price: 59900, sku: `REC-${run}`, inventory_policy: "continue" }],
    })})`;
    await sql`select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
      title: "Creatina pausada",
      slug: "creatina-pausada",
      variants: [{ price: 39900, sku: `PAU-${run}`, inventory_policy: "continue" }],
    })})`;
  });
  // Ya se vendió y la dueña la pausó: «Publicar los completos» no debe tocarla.
  await admin`update public.products set published_at = now() - interval '2 days'
               where store_id = ${tenant.storeId} and slug = 'creatina-pausada'`;
  // Mismo archivo importado hace un rato y otra vez listo para confirmar.
  const [done] = await admin<{ id: string }[]>`
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, totals, committed_at)
    values (${tenant.storeId}, 'products', 'create_only', 'completed', 'catalogo.csv', ${ownerId},
            ${admin.json({ rows: 1, products: 1, created: 1 })}, now() - interval '1 hour')
    returning id`;
  const [again] = await admin<{ id: string }[]>`
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, totals)
    values (${tenant.storeId}, 'products', 'create_only', 'validated', 'catalogo.csv', ${ownerId},
            ${admin.json({ rows: 1, products: 1, create: 1, errors: 0 })})
    returning id`;
  const [failed] = await admin<{ id: string }[]>`
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, totals, error)
    values (${tenant.storeId}, 'products', 'create_only', 'failed', 'otro.csv', ${ownerId},
            ${admin.json({ rows: 1, products: 1, create: 1, errors: 0 })},
            'fila 2: ya existe un producto con ese handle')
    returning id`;
  // Archivo con errores: resumen por columna y sugerencia de modo (B3).
  const [withErrors] = await admin<{ id: string }[]>`
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, totals)
    values (${tenant.storeId}, 'products', 'create_only', 'validated', 'con-errores.csv', ${ownerId},
            ${admin.json({ rows: 3, products: 3, create: 1, errors: 2 })})
    returning id`;
  await admin`
    insert into public.import_job_rows (store_id, import_job_id, row_number, raw, errors, action)
    values (${tenant.storeId}, ${withErrors!.id}, 2, ${admin.json({ handle: "proteina-recorrido" })},
            ${admin.json(["handle: ya existe un producto con ese handle"])}, 'error'),
           (${tenant.storeId}, ${withErrors!.id}, 3, ${admin.json({ handle: "nuevo" })},
            ${admin.json(["price: escribe un importe como 199.50"])}, 'error')`;
  jobs.withErrors = withErrors!.id;
  jobs.done = done!.id;
  jobs.again = again!.id;
  jobs.failed = failed!.id;
});

test("todas las pantallas del panel cargan sin errores; estado del sistema y avisos de importación", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await loginNewStaff(page, ownerEmail);

  const issues: string[] = [];
  let current = "";
  page.on("pageerror", (e) => issues.push(`${current} · excepción: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !KNOWN_CONSOLE.test(m.text()))
      issues.push(`${current} · consola: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) issues.push(`${current} · HTTP ${r.status()}: ${r.url()}`);
  });

  const base = `/admin/${tenant.handle}`;
  const queue = ["/admin", base, "/seguridad/contrasena"];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < 160) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    current = url;
    const res = await page.goto(url, { waitUntil: "networkidle" });
    const status = res?.status() ?? 0;
    if (status >= 400) issues.push(`${url} · estado ${status}`);
    const body = await page.locator("body").innerText();
    if (/This page couldn.t load|Application error|Algo salió mal/i.test(body))
      issues.push(`${url} · página de error`);
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    for (const h of hrefs) {
      const clean = h.split("#")[0]!;
      if (!clean.startsWith(base) && clean !== "/seguridad/contrasena") continue;
      // Descargas (CSV) y cierre de sesión no son pantallas.
      if (/\/(errores|plantilla|descargar|salir)\b|\.csv/.test(clean)) continue;
      if (!seen.has(clean)) queue.push(clean);
    }
  }
  expect(issues).toEqual([]);
  expect(seen.size).toBeGreaterThan(30);

  // Inicio: estado del sistema para quien administra la tienda (A2).
  await page.goto(`/admin/${tenant.handle}`);
  const section = page.getByRole("region", { name: "Estado del sistema" });
  await expect(section).toBeVisible();
  // El stack local tiene todo configurado y no hay trabajo en cola.
  await expect(section.getByText("Todo funciona: no hay trabajos en espera.")).toBeVisible();

  // Importación repetida y handle existente (A3).
  const imports = `/admin/${tenant.handle}/productos/importar`;
  await page.goto(`${imports}/${jobs.again!}`);
  await expect(page.getByText(/Un archivo con este nombre ya se importó/)).toBeVisible();
  // Se puede confirmar (quizá es otra versión), pero queda advertido.
  await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeVisible();

  await page.goto(`${imports}/${jobs.withErrors!}`);
  await expect(
    page.getByText("Por columna: Nombre corto (1 fila), Precio (1 fila)."),
  ).toBeVisible();
  await expect(page.getByText(/Algunos productos ya están en tu catálogo/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar importación" })).toHaveCount(0);

  await page.goto(`${imports}/${jobs.failed!}`);
  await expect(page.getByText(/Crear los nuevos y actualizar los existentes/)).toBeVisible();

  // Revisión: publicar de una vez los nuevos completos; la base decide (B2).
  await page.goto(`/admin/${tenant.handle}/productos/revision`);
  await expect(page.getByText("Tienes 1 producto nuevo sin publicar.")).toBeVisible();
  await page.getByRole("button", { name: "Publicar los completos" }).click();
  const result = page.getByRole("status").filter({ hasText: /publicad/ });
  await expect(result).toBeVisible();
  const states = await admin<{ slug: string; status: string }[]>`
    select slug, status from public.products where store_id = ${tenant.storeId} order by slug`;
  const paused = states.find((p) => p.slug === "creatina-pausada");
  expect(paused?.status).toBe("draft");
  const active = states.filter((p) => p.status === "active").length;
  await expect(result).toContainText(
    `${active} ${active === 1 ? "producto publicado" : "productos publicados"}`,
  );
});
