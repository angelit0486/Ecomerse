import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  admin,
  createAuthUser,
  enrollTotp,
  enterEmailCode,
  loginNewStaff,
  readInvitationLink,
  runJobs,
  uniq,
} from "../e2e/support";

import { CATALOGOS, toSheetCsv, type Giro } from "./catalogos";

/**
 * Ensayo del guion de implementación en cinco días (O10-01) con tiendas
 * SINTÉTICAS: sigue `docs/runbooks/implementacion-de-tienda.md` por la
 * interfaz, como lo haría quien implementa, y mide cada fase. No es una entrega
 * comercial. Los tiempos son de la máquina local siguiendo el guion sin dudar:
 * miden la plataforma y el número de pasos, no el tiempo de una persona.
 *
 *   ENSAYO_GIROS=ropa,hogar ENSAYO_OUT=/ruta pnpm exec playwright test -c playwright.ensayo.config.ts
 */
const GIROS = (process.env.ENSAYO_GIROS ?? "ropa,hogar,abarrotes,suplementos").split(",") as Giro[];
const OUT = process.env.ENSAYO_OUT ?? "test-results/ensayo";

interface Fase {
  fase: string;
  ms: number;
  notas: string[];
}

async function photo(seed: number): Promise<Buffer> {
  const hue = (seed * 47) % 360;
  return sharp({
    create: { width: 1200, height: 1200, channels: 3, background: `hsl(${hue}, 45%, 55%)` },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1200" height="1200"><circle cx="600" cy="600" r="${300 + (seed % 5) * 40}" fill="white" fill-opacity="0.6"/></svg>`,
        ),
      },
    ])
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function waitJobs(page: Page, until: () => Promise<boolean>, timeoutMs = 600_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await runJobs();
    if (await until()) return;
    await page.waitForTimeout(500);
  }
  throw new Error("La cola no terminó a tiempo");
}

for (const giro of GIROS) {
  test(`ensayo sintético: ${giro}`, async ({ page, browser }) => {
    test.setTimeout(30 * 60_000);
    const cat = CATALOGOS[giro]();
    const run = uniq();
    const handle = `ensayo-${giro}-${run}`;
    const ownerEmail = `duena-${giro}-${run}@example.test`;
    const operatorEmail = `operador-${run}@platform.test`;
    const fases: Fase[] = [];
    const hallazgos: string[] = [];
    const fase = async (nombre: string, fn: (notas: string[]) => Promise<void>) => {
      const notas: string[] = [];
      const t0 = Date.now();
      try {
        await test.step(nombre, () => fn(notas));
      } catch (error) {
        notas.push(`FALLÓ: ${String(error).split("\n")[0]}`);
        throw error;
      } finally {
        fases.push({ fase: nombre, ms: Date.now() - t0, notas });
        guardar();
      }
    };
    const guardar = () => {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        join(OUT, `ensayo-${giro}.json`),
        JSON.stringify({ giro, tienda: cat.tienda, handle, fases, hallazgos }, null, 2),
      );
    };

    // Precondiciones de la plataforma (no se cronometran): la persona que
    // implementa ya tiene cuenta de operación y el plan comercial existe.
    await admin`insert into public.platform_staff (user_id, role)
                values (${await createAuthUser(operatorEmail)}, 'platform_admin')`;
    const [plan] = await admin<{ id: string }[]>`
      insert into public.plans (key, name) values ('ensayo_plan', 'Plan ensayo')
      on conflict (key) do update set name = excluded.name returning id`;
    await admin`insert into public.plan_entitlements (plan_id, key, value_int)
                values (${plan!.id}, 'max_stores', 3), (${plan!.id}, 'max_staff', 5),
                       (${plan!.id}, 'max_products', 10000), (${plan!.id}, 'storage_mb', 20000)
                on conflict do nothing`;

    // ---------------- Día 1: alta y diseño ----------------
    let owner!: Page;
    await fase("Día 1 · Alta (plataforma + acceso de la dueña)", async (notas) => {
      await loginNewStaff(page, operatorEmail);
      await page.goto("/platform/organizaciones/nueva");
      await page.getByLabel("Nombre de la organización").fill(cat.tienda);
      await page.getByLabel("Slug de la organización").fill(`org-${handle}`);
      await page.getByLabel("Email del dueño").fill(ownerEmail);
      await page.getByLabel("Nombre de la tienda").fill(cat.tienda);
      await page.getByLabel("Dirección de la tienda (handle)").fill(handle);
      await page.getByRole("combobox", { name: "Plan" }).selectOption({ label: "Plan ensayo" });
      await page.getByRole("button", { name: "Crear organización y tienda" }).click();
      await expect(page.getByText(new RegExp(`Tienda creada en ${handle}`))).toBeVisible();
      await runJobs();
      const invitation = await readInvitationLink(ownerEmail);
      const ctx = await browser.newContext({ locale: "es-MX" });
      owner = await ctx.newPage();
      await owner.goto(invitation);
      const sentAt = Date.now() - 1000;
      await owner.getByRole("button", { name: "Enviarme un código" }).click();
      await enterEmailCode(owner, ownerEmail, sentAt);
      await enrollTotp(owner);
      await owner.getByRole("button", { name: "Aceptar invitación" }).click();
      await expect(owner).toHaveURL(new RegExp(`/admin/${handle}$`));
      notas.push("Invitación por correo + código + verificación en dos pasos.");
    });

    const base = `/admin/${handle}`;
    await fase("Día 1 · Plantilla, logo, colores y funciones", async (notas) => {
      await owner.goto(`${base}/configuracion`);
      const section = owner.getByRole("region", { name: "Plantilla por giro" });
      await section.getByRole("radio", { name: cat.plantilla }).check();
      await section.getByRole("button", { name: "Aplicar plantilla" }).click();
      await section.getByRole("button", { name: "Sí, aplicar" }).click();
      const applied = owner.getByText(/Plantilla «.+» aplicada al borrador/);
      await expect(applied).toBeVisible({ timeout: 30_000 });
      const msg = (await applied.textContent()) ?? "";
      notas.push(msg.trim());
      const ejemplos = /con (\d+) productos de ejemplo/.exec(msg)?.[1];
      if (ejemplos) {
        await owner
          .getByRole("button", { name: `Quitar los ${ejemplos} productos de ejemplo` })
          .click();
        await owner
          .getByRole("button", { name: `Sí, quitar los ${ejemplos} productos de ejemplo` })
          .click();
        await expect(
          owner.getByRole("button", { name: `Quitar los ${ejemplos} productos de ejemplo` }),
        ).toHaveCount(0);
        notas.push(`Se quitaron ${ejemplos} productos de ejemplo antes de importar.`);
      }
      // Datos del negocio.
      await owner.getByLabel("Email de contacto").fill(`hola@${handle}.example.test`);
      await owner.getByRole("button", { name: "Guardar datos" }).click();
      await expect(owner.getByText(/guardad/i).first()).toBeVisible();
      // Logo.
      const logo = await sharp({
        create: { width: 600, height: 200, channels: 4, background: "#1d3557" },
      })
        .png()
        .toBuffer();
      await owner.getByLabel("Subir logo").setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: logo,
      });
      await expect(async () => {
        await runJobs();
        await owner.reload();
        await expect(owner.getByRole("button", { name: "Usar este logo" })).toBeVisible({
          timeout: 3_000,
        });
      }).toPass({ timeout: 60_000 });
      await owner.getByRole("button", { name: "Usar este logo" }).click();
      // Colores de marca.
      await owner.getByLabel("Color principal (botones y enlaces)").fill("#1d3557");
      await owner.getByRole("button", { name: "Guardar en el borrador" }).click();
      await expect(owner.getByText("Guardado en el borrador.", { exact: false })).toBeVisible();
      // Funciones del guion.
      await owner.goto(`${base}/ajustes/funciones`);
      for (const f of [
        "Ayuda en el panel",
        "Devoluciones",
        "Salud de tu tienda",
        "Notas de empaque",
      ]) {
        const card = owner.getByRole("form", { name: f });
        const on = card.getByRole("button", { name: new RegExp(`^Encender ${f}`, "i") });
        if ((await on.count()) > 0) {
          await on.click();
          await expect(
            owner.getByRole("status").filter({ hasText: new RegExp(`${f}: encendida`, "i") }),
          ).toBeVisible();
        }
      }
    });

    // ---------------- Día 2: catálogo ----------------
    await fase("Día 2 · Catálogo (hoja del giro, corrección e importación)", async (notas) => {
      // La hoja del giro trae exactamente las columnas del catálogo sintético.
      const sheet = await owner.request.get(
        `${base}/productos/importar/plantilla?giro=${cat.hoja}`,
      );
      const headers = (await sheet.text())
        .replace(/^\uFEFF+/, "")
        .split(/\r?\n/)[0]!
        .split(",");
      expect(headers).toEqual(cat.encabezados);
      notas.push(`${cat.filas.length} filas, ${cat.skuFoto.length} productos.`);

      await owner.goto(`${base}/productos/importar`);
      await owner.getByLabel(/Archivo CSV/).setInputFiles({
        name: `catalogo-${giro}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(toSheetCsv(cat, true)),
      });
      await owner.getByRole("button", { name: "Validar archivo" }).click();
      await expect(owner.getByRole("heading", { name: `catalogo-${giro}.csv` })).toBeVisible({
        timeout: 60_000,
      });
      const body = (await owner.locator("main").innerText()).split("\n");
      const errores = body.filter((l) =>
        /: (escribe|no existe|falta|repetid|debe|ya existe)/i.test(l),
      );
      notas.push(`Primera validación: ${errores.length} mensajes de error.`);
      errores.slice(0, 12).forEach((e) => notas.push(`  · ${e.trim()}`));
      const faltantes = [
        ...new Set(
          errores.flatMap((l) =>
            [...l.matchAll(/no existe la categoría ([^,;.]+)/g)].map((m) => m[1]!.trim()),
          ),
        ),
      ];
      if (faltantes.length > 0) {
        hallazgos.push(
          `La plantilla del giro no trae las categorías ${faltantes.join(", ")}; hubo que crearlas antes de importar (la importación no crea categorías, ADR-065 pendiente).`,
        );
        const cats = owner.context().newPage();
        const p = await cats;
        await p.goto(`${base}/productos/categorias`);
        for (const name of faltantes) {
          await p.getByLabel("Nombre").first().fill(name);
          await p.getByRole("button", { name: "Crear categoría" }).click();
          await expect(p.getByRole("option", { name, exact: true }).first()).toBeAttached();
        }
        await p.close();
        notas.push(`Categorías creadas a mano: ${faltantes.join(", ")}.`);
      }
      await owner.getByLabel("Corrige el archivo y súbelo aquí de nuevo").setInputFiles({
        name: `catalogo-${giro}-corregido.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(toSheetCsv(cat, false)),
      });
      await owner.getByRole("button", { name: "Validar el archivo corregido" }).click();
      await expect(
        owner.getByRole("heading", { name: `catalogo-${giro}-corregido.csv` }),
      ).toBeVisible({ timeout: 60_000 });
      await owner.getByRole("button", { name: "Confirmar importación" }).click();
      await expect(
        owner.getByRole("status").filter({ hasText: /Importando…|Importación terminada\./ }),
      ).toBeVisible();
      await expect(async () => {
        await runJobs();
        await expect(owner.getByText("Importación terminada.")).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 300_000 });
      const [counts] = await admin<{ total: number; active: number; variants: number }[]>`
        select count(*)::int as total, count(*) filter (where p.status = 'active')::int as active,
               (select count(*)::int from public.product_variants v join public.products pp on pp.id = v.product_id and pp.store_id = v.store_id where v.store_id = s.id and pp.deleted_at is null) as variants
          from public.stores s join public.products p on p.store_id = s.id
         where s.handle = ${handle} and p.deleted_at is null group by s.id`;
      notas.push(
        `Importados: ${counts!.total} productos (${counts!.variants} presentaciones); publicados: ${counts!.active}.`,
      );
      if (counts!.active < counts!.total) {
        hallazgos.push(
          `La importación deja ${counts!.total - counts!.active} productos en borrador: hay que publicarlos en bloque.`,
        );
      }
    });

    // ---------------- Día 3: fotos ----------------
    await fase("Día 3 · Fotos (subida en lote por SKU y procesamiento)", async (notas) => {
      const files = await Promise.all(
        cat.skuFoto.map(async (s, i) => ({
          name: `${s.sku}.jpg`,
          mimeType: "image/jpeg",
          buffer: await photo(i),
        })),
      );
      await owner.goto(`${base}/productos/importar/imagenes`);
      await owner.getByLabel(/^Fotos/).setInputFiles(files);
      const subir = owner.getByRole("button", { name: `Subir ${files.length} fotos` });
      await expect(subir).toBeVisible({ timeout: 60_000 });
      const tUp = Date.now();
      await subir.click();
      // Termina cuando la página confirma todas las subidas (no basta con que
      // el botón desaparezca: mientras sube tampoco se muestra).
      await expect(
        owner.getByRole("status").filter({ hasText: new RegExp(`${files.length} fotos subidas`) }),
      ).toBeVisible({ timeout: 600_000 });
      notas.push(`${files.length} fotos subidas en ${Math.round((Date.now() - tUp) / 1000)} s.`);
      const tProc = Date.now();
      await waitJobs(owner, async () => {
        const [m] = await admin<{ pending: number }[]>`
          select count(*)::int as pending from public.media m join public.stores s on s.id = m.store_id
           where s.handle = ${handle} and m.owner_type = 'product' and m.status in ('pending', 'processing')`;
        return m!.pending === 0;
      });
      const [m] = await admin<{ ready: number; rejected: number }[]>`
        select count(*) filter (where m.status = 'ready')::int as ready,
               count(*) filter (where m.status = 'rejected')::int as rejected
          from public.media m join public.stores s on s.id = m.store_id
         where s.handle = ${handle} and m.owner_type = 'product'`;
      notas.push(
        `Procesadas en ${Math.round((Date.now() - tProc) / 1000)} s: ${m!.ready} listas, ${m!.rejected} rechazadas.`,
      );
    });

    // ---------------- Día 4: envíos, cobro y textos ----------------
    await fase("Día 4 · Envíos, cobro y políticas", async (notas) => {
      await owner.goto(`${base}/envios`);
      const zoneName = owner.getByRole("textbox", { name: "Nombre de la zona", exact: true });
      if ((await owner.getByRole("textbox", { name: "Nombre de la zona México" }).count()) === 0) {
        await zoneName.fill("México");
        await owner.getByRole("button", { name: "Crear zona" }).click();
        await expect(
          owner.getByRole("textbox", { name: "Nombre de la zona México" }),
        ).toBeVisible();
      } else {
        notas.push("La plantilla ya traía la zona México.");
      }
      if (
        (await owner.getByRole("textbox", { name: /^Nombre de la tarifa Estándar/ }).count()) === 0
      ) {
        await owner
          .getByRole("textbox", { name: "Nombre de la tarifa", exact: true })
          .first()
          .fill("Estándar");
        await owner
          .getByRole("textbox", { name: /^Precio/ })
          .last()
          .fill("99");
        await owner.getByRole("button", { name: "Agregar tarifa" }).first().click();
        await expect(
          owner.getByRole("textbox", { name: /^Nombre de la tarifa Estándar/ }),
        ).toBeVisible();
      }
      await owner.goto(`${base}/configuracion`);
      await owner
        .getByLabel("Instrucciones de pago")
        .fill(`Banco Ejemplo · CLABE 012345678901234567 · Titular: ${cat.tienda}`);
      await owner.getByRole("button", { name: "Guardar pago" }).click();
      await expect(owner.getByText("Pago por transferencia guardado.")).toBeVisible();
      // Políticas: el comercio las redacta; aquí, texto sintético.
      const pendientes = owner.getByRole("list", { name: "Pendientes para publicar" });
      const items =
        (await pendientes.count()) > 0
          ? await pendientes.getByRole("listitem").allTextContents()
          : [];
      notas.push(`Pendientes antes de las políticas: ${items.join(" | ") || "ninguno"}.`);
      await owner.goto(`${base}/contenido`);
      const politicas = [
        "Aviso de privacidad",
        "Términos y condiciones",
        "Cambios y devoluciones",
        "Envíos",
      ];
      for (const nombre of politicas) {
        const link = owner.getByRole("table").getByRole("link", { name: nombre, exact: true });
        if ((await link.count()) === 0) {
          notas.push(`No se encontró la página «${nombre}».`);
          continue;
        }
        await link.first().click();
        await owner
          .getByLabel("Contenido")
          .fill(`<h2>${nombre}</h2><p>Texto de ${cat.tienda} (sintético, ensayo O10-01).</p>`);
        await owner.getByRole("button", { name: "Guardar", exact: true }).click();
        await expect(
          owner.getByRole("status").filter({ hasText: "Página guardada." }),
        ).toBeVisible();
        const publicar = owner.getByRole("button", { name: "Publicar" });
        if ((await publicar.count()) > 0) {
          await publicar.click();
          await expect(
            owner.getByRole("status").filter({ hasText: "Página publicada." }),
          ).toBeVisible();
        }
        await owner.goto(`${base}/contenido`);
      }
    });

    // ---------------- Día 5: pruebas y entrega ----------------
    await fase("Día 5 · Revisión, publicación y compra de prueba", async (notas) => {
      // Publicar productos que quedaron en borrador (página por página).
      for (let vuelta = 0; vuelta < 30; vuelta++) {
        await owner.goto(`${base}/productos?estado=draft`);
        const all = owner.getByLabel("Seleccionar todos");
        // Sin filas de producto no queda nada en borrador (el «todos» sigue visible).
        const filas = owner.getByRole("checkbox", { name: /^Seleccionar (?!todos)/ });
        if ((await all.count()) === 0 || (await filas.count()) === 0) break;
        await all.check();
        await owner.locator("#bulk-action").selectOption("publish");
        const antes = await filas.count();
        await owner.getByRole("button", { name: "Aplicar" }).click();
        await owner.waitForTimeout(1500);
        const aviso = (await owner.getByRole("alert").allInnerTexts()).join(" ").trim();
        // El aviso puede desaparecer al refrescarse la lista filtrada: se espera
        // a que esas filas salgan de «borrador».
        try {
          await expect(async () => {
            await owner.reload();
            expect(await filas.count()).toBeLessThan(antes);
          }).toPass({ timeout: 30_000 });
        } catch {
          hallazgos.push(`Publicar en bloque no publicó nada${aviso ? `: «${aviso}»` : ""}.`);
          break;
        }
        const despues = await filas.count();
        notas.push(`Publicar en bloque (vuelta ${vuelta + 1}): ${antes - despues} publicados.`);
        if (despues === antes) break;
      }
      // Inicio: alertas.
      await owner.goto(base);
      const alertas = owner.getByRole("region", { name: "Qué atender hoy" });
      if ((await alertas.count()) > 0) {
        const items = await alertas.getByRole("listitem").allInnerTexts();
        items.forEach((t) => notas.push(`Alerta: ${t.split("\n").slice(0, 2).join(" — ")}`));
      }
      // Publicar la tienda.
      await owner.goto(`${base}/configuracion`);
      const pendientes = owner.getByRole("list", { name: "Pendientes para publicar" });
      if ((await pendientes.count()) > 0) {
        const items = await pendientes.getByRole("listitem").allTextContents();
        notas.push(`Pendientes para publicar: ${items.join(" | ")}`);
        hallazgos.push(`Antes de publicar faltaba: ${items.join(" | ")}`);
        guardar();
      }
      await owner.getByRole("button", { name: "Publicar tienda" }).click();
      await expect(owner.getByText("Tu tienda está publicada")).toBeVisible();
      // Compra de prueba anónima con transferencia.
      const buyer = await browser.newContext({ locale: "es-MX" });
      const shop = await buyer.newPage();
      // El dominio que la plataforma le asignó (p. ej. {handle}.tiendas.localhost).
      const [dom] = await admin<{ hostname: string }[]>`
        select d.hostname from public.store_domains d join public.stores s on s.id = d.store_id
         where s.handle = ${handle} and d.is_primary`;
      const origin = `http://${dom!.hostname}:3000`;
      notas.push(`Tienda pública en ${origin}/ (dominio de la plataforma).`);
      const tShop = Date.now();
      expect((await shop.goto(`${origin}/`))?.status()).toBe(200);
      await shop.goto(
        `${origin}/buscar?q=${encodeURIComponent(cat.skuFoto[0]!.producto.split(" ")[0]!)}`,
      );
      const [prod] = await admin<{ slug: string }[]>`
        select p.slug from public.products p join public.stores s on s.id = p.store_id
         where s.handle = ${handle} and p.status = 'active' and p.deleted_at is null
           and exists (select 1 from public.product_variants v where v.product_id = p.id and v.store_id = p.store_id
                        and (not v.track_inventory or exists (select 1 from public.inventory_levels l where l.store_id = v.store_id and l.variant_id = v.id and l.available > 0)))
         order by p.created_at limit 1`;
      await shop.goto(`${origin}/productos/${prod!.slug}`);
      await shop.getByRole("button", { name: "Agregar al carrito" }).click();
      await expect(
        shop.getByRole("status").filter({ hasText: "Agregado al carrito." }),
      ).toBeVisible();
      await shop.getByRole("link", { name: /^Ver carrito/ }).click();
      await shop.getByRole("link", { name: "Continuar al pago" }).click();
      await shop.getByRole("textbox", { name: "Email" }).fill("comprador@example.test");
      await shop.getByLabel("Nombre completo").fill("Comprador Ensayo");
      await shop.getByLabel(/^Teléfono/).fill("2221234567");
      await shop.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
      await shop.getByLabel("Colonia").fill("Centro");
      await shop.getByLabel("Ciudad o municipio").fill("Puebla");
      await shop.getByLabel("Código postal").fill("72000");
      // Primer clic: el servidor elige el envío y pide confirmar con el total a la vista.
      const confirmar = shop.getByRole("button", { name: /Confirmar pedido/ });
      const gracias = shop.getByText("Transferencia bancaria").first();
      await confirmar.click();
      const elegido = shop.getByRole("alert").filter({ hasText: /Elegimos/ });
      await expect(elegido.or(gracias).first()).toBeVisible({ timeout: 30_000 });
      if (await elegido.isVisible()) {
        notas.push(`Pago: ${(await elegido.innerText()).trim()}`);
        await confirmar.click();
      }
      // Con transferencia la página del pedido no dice «Gracias»: muestra el
      // número y las instrucciones de pago.
      await expect(shop).toHaveURL(/\/pedido\/[0-9a-f-]+\?t=/, { timeout: 30_000 });
      await expect(shop.getByText("Transferencia bancaria").first()).toBeVisible();
      notas.push(
        `Compra de prueba (transferencia) en ${Math.round((Date.now() - tShop) / 1000)} s.`,
      );
      await buyer.close();
      await owner.goto(`${base}/pedidos`);
      await expect(owner.getByRole("row").nth(1)).toBeVisible();
      notas.push("El pedido aparece en el panel.");
    });

    guardar();
    await owner.context().close();
  });
}
