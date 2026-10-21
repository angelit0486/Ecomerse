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
 * ADR-034 · Estudio de diseño (tema v2): la dueña arma la portada con bloques
 * nuevos (preguntas frecuentes, beneficios, video y contacto), elige en qué
 * dispositivo se ve cada uno, cambia la presentación de la ficha y la densidad,
 * y lo publica. La tienda lo respeta en el celular y en la computadora, el video
 * no carga nada externo hasta tocarlo y no hay violaciones de CSP ni de axe.
 */
const run = uniq();
const ownerEmail = `estudio-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

const store = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`es${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    for (const title of ["Proteína vainilla", "Proteína chocolate"]) {
      const sku = `${title.slice(-4).toUpperCase()}-${run}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId},
          ${sql.json({ title, variants: [{ price: 59900, sku, inventory_policy: "continue" }] })}) as r`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    }
  });
  await admin`update public.store_themes
                 set settings = ${admin.json({ contact: { address: "Av. Juárez 10, La Paz, BCS", hours: "Lunes a sábado, 9 a 19 h", whatsapp: "+526121234567" } })}
               where store_id = ${tenant.storeId}`;
});

test("bloques nuevos, dónde se ven y presentación de la ficha", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);

  // Preguntas frecuentes, solo en el celular.
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Preguntas frecuentes" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page.getByLabel("Pregunta", { exact: true }).fill("¿Hacen envíos a todo México?");
  await page.getByLabel("Respuesta").fill("Sí, de 2 a 5 días hábiles.");
  await page.getByRole("button", { name: "Agregar pregunta" }).click();
  await page.getByLabel("Pregunta", { exact: true }).nth(1).fill("¿Puedo pagar en OXXO?");
  await page.getByLabel("Respuesta").nth(1).fill("Sí, con Mercado Pago.");
  await page.getByLabel("Dispositivos").selectOption({ label: "Solo en el celular" });
  await expect(
    page.getByRole("heading", { name: /Preguntas frecuentes \(solo celular\)/ }),
  ).toBeVisible();

  // Beneficios, solo en la computadora.
  await page.getByRole("button", { name: "Cerrar Preguntas frecuentes" }).click();
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Beneficios y confianza" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page.getByLabel("Título", { exact: true }).fill("Envío gratis desde $999");
  await page.getByLabel("Dispositivos").selectOption({ label: "Solo en la computadora" });
  await page.getByRole("button", { name: "Cerrar Beneficios y confianza" }).click();

  // Video: se pega el enlace; se guarda solo el código.
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Video" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page
    .getByLabel("Enlace del video de YouTube o Vimeo")
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5");
  await page.getByLabel("Título del video").fill("Cómo preparar tu batido");
  await page.getByRole("button", { name: "Cerrar Video" }).click();

  // Contacto con WhatsApp.
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Contacto y ubicación" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page.getByRole("button", { name: "Cerrar Contacto y ubicación" }).click();

  // Esquema por dispositivo: en el celular no está el bloque de solo computadora.
  const scheme = page.getByRole("list", { name: "Bloques visibles en el celular" });
  await expect(scheme.getByText("Preguntas frecuentes", { exact: true }).first()).toBeVisible();
  await expect(scheme.getByText("Beneficios y confianza", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Computadora" }).click();
  const desktopScheme = page.getByRole("list", { name: "Bloques visibles en la computadora" });
  await expect(desktopScheme.getByText("Beneficios y confianza", { exact: true })).toBeVisible();
  await expect(desktopScheme.getByText("Preguntas frecuentes", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portada guardada en el borrador" }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [video] = await admin<{ props: Record<string, string> }[]>`
    select s -> 'props' as props from public.store_themes t, jsonb_array_elements(t.draft_home_sections) s
     where t.store_id = ${tenant.storeId} and s ->> 'type' = 'video'`;
  expect(video!.props).toMatchObject({ provider: "youtube", video_id: "dQw4w9WgXcQ" });

  // Ficha y listados + espacio amplio.
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=presentacion`);
  await page.getByLabel("Mostrar productos relacionados").uncheck();
  await page.getByRole("button", { name: "Guardar en el borrador" }).click();
  await expect(page.getByRole("status").filter({ hasText: /borrador/ })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();

  // Tienda en el celular: preguntas sí, beneficios no; video sin iframe hasta tocarlo.
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const shopper = await phone.newPage();
  const external: string[] = [];
  shopper.on("request", (r) => {
    if (/youtube|vimeo/.test(r.url())) external.push(r.url());
  });
  await shopper.goto(store());
  await expect(shopper.getByRole("heading", { name: "Preguntas frecuentes" })).toBeVisible();
  await expect(shopper.getByText("Envío gratis desde $999")).toBeHidden();
  await shopper.getByText("¿Puedo pagar en OXXO?").click();
  await expect(shopper.getByText("Sí, con Mercado Pago.")).toBeVisible();
  await expect(shopper.locator("iframe")).toHaveCount(0);
  expect(external).toEqual([]);
  await expect(shopper.getByRole("link", { name: /Escríbenos por WhatsApp/ })).toHaveAttribute(
    "href",
    "https://wa.me/526121234567",
  );
  await expect(shopper.getByRole("link", { name: /Ver en el mapa/ })).toHaveAttribute(
    "href",
    /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Av\.%20Ju%C3%A1rez/,
  );
  await expectNoSeriousA11yViolations(shopper);
  await shopper.getByRole("button", { name: /Reproducir: Cómo preparar tu batido/ }).click();
  await expect(shopper.locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0",
  );
  await expect(shopper.locator("iframe")).toHaveAttribute("title", "Cómo preparar tu batido");

  // Ficha sin relacionados (presentación v2).
  await shopper.goto(`${store()}/productos/proteina-vainilla`);
  await expect(shopper.getByRole("heading", { name: "Más para tu objetivo" })).toHaveCount(0);
  await phone.close();

  // Computadora: beneficios sí, preguntas no.
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wide = await desktop.newPage();
  await wide.goto(store());
  await expect(wide.getByText("Envío gratis desde $999")).toBeVisible();
  await expect(wide.getByRole("heading", { name: "Preguntas frecuentes" })).toBeHidden();
  await expectNoSeriousA11yViolations(wide);

  // Historial (ADR-034 §4): se quita el video, se publica, y se vuelve a la versión anterior.
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);
  await page.getByRole("button", { name: "Editar Video" }).click();
  await page.getByRole("button", { name: "Eliminar Video" }).click();
  await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portada guardada en el borrador" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();
  await wide.goto(store());
  await expect(wide.getByRole("heading", { name: "Cómo preparar tu batido" })).toHaveCount(0);

  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=historial`);
  const versions = page.getByRole("list", { name: "Versiones publicadas" });
  await expect(versions.getByText("Versión 2 (publicada ahora)")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Restaurar la versión 1 al borrador" }).click();
  await expect(page.getByText(/Versión 1 copiada al borrador/)).toBeVisible();
  // Restaurar no publica: la tienda sigue sin el video hasta publicar.
  await wide.reload();
  await expect(wide.getByRole("heading", { name: "Cómo preparar tu batido" })).toHaveCount(0);
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();
  await wide.reload();
  await expect(wide.getByRole("heading", { name: "Cómo preparar tu batido" })).toBeVisible();
  await desktop.close();
});
