import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { MAIL, admin, loginNewStaff, runJobs, uniq } from "../e2e/support";

/**
 * Recorrido del primer pedido en `demo2` (stack local, `pnpm demo:seed:neutral`):
 * compra completa con el pago de prueba, correos, panel (pedido, envío con guía,
 * pendientes y cancelación) y revisión en el celular (375 px). Escribe capturas
 * y un registro en $PRIMER_PEDIDO_OUT (por defecto docs/audit/primer-pedido).
 * No forma parte de `pnpm test:e2e`. La dueña local de demo2 no debe tener 2FA
 * (loginNewStaff la enrola).
 */
test.describe.configure({ mode: "serial" });

const OUT = process.env.PRIMER_PEDIDO_OUT ?? "docs/audit/primer-pedido";
const STORE = "http://demo2.localhost:3000";
const OWNER = "demo2@example.test";
const run = uniq();
const buyer = `comprador-${run}@example.test`;
const log: string[] = [];
let step = 0;
let orderNumber = "";
let orderId = "";

mkdirSync(OUT, { recursive: true });
const note = (line: string) => log.push(line);

async function shot(page: Page, name: string, detail: string) {
  step += 1;
  const file = `${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  note(`${step}. ${detail} → ${file}`);
}

/** Sin desplazamiento horizontal, sin campos que hagan zoom en iPhone, sin nada cortado. */
async function phoneCheck(page: Page, where: string) {
  const r = await page.evaluate(() => {
    const scrollsX = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
      }
      return false;
    };
    const w = window.innerWidth;
    const cut = [...document.querySelectorAll("body *")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return (
          b.width > 0 &&
          b.height > 0 &&
          (b.right > w + 1 || b.left < -1) &&
          s.position !== "fixed" &&
          s.visibility !== "hidden" &&
          !e.closest("[aria-hidden='true'],.sr-only") &&
          !scrollsX(e.parentElement)
        );
      })
      .slice(0, 5)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""} «${(e.textContent ?? "").trim().slice(0, 30)}»`,
      );
    const zoom = [
      ...document.querySelectorAll<HTMLElement>(
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea",
      ),
    ]
      .filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16)
      .map((e) => e.getAttribute("name") ?? e.id ?? e.tagName);
    return {
      overflow: document.documentElement.scrollWidth - w,
      zoom,
      cut,
      viewport: document.querySelector("meta[name=viewport]")?.getAttribute("content") ?? "",
    };
  });
  note(
    `   celular ${where}: desborde horizontal ${r.overflow}px; campos < 16px: ${r.zoom.length ? r.zoom.join(", ") : "ninguno"}; cortados: ${r.cut.length ? r.cut.join("; ") : "ninguno"}; viewport «${r.viewport}»`,
  );
  return r;
}

async function mail(to: string, subject: RegExp) {
  for (let i = 0; i < 80; i += 1) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await res.json()) as {
      messages: { ID: string; Subject: string }[];
    };
    const found = messages.filter((m) => subject.test(m.Subject));
    if (found.length) {
      const m = (await (await fetch(`${MAIL}/api/v1/message/${found[0]!.ID}`)).json()) as {
        HTML: string;
        Text: string;
        Subject: string;
      };
      return { ...m, count: found.length };
    }
    if (i % 10 === 9) await runJobs();
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No llegó «${subject}» a ${to}`);
}

async function showMail(page: Page, html: string, name: string, detail: string) {
  await page.setContent(html);
  await shot(page, name, detail);
}

async function buy(page: Page, phone: boolean, approve: boolean) {
  await page.goto(`${STORE}/productos`);
  if (phone) await phoneCheck(page, "catálogo");
  await page.locator('main a[href^="/productos/"]').first().click();
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeVisible();
  if (phone) await phoneCheck(page, "ficha del producto");
  if (!phone) await shot(page, "producto", "Ficha del producto");
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${STORE}/carrito`);
  await expect(page.getByRole("heading", { name: "Tu carrito" })).toBeVisible();
  if (phone) await phoneCheck(page, "carrito");
  else await shot(page, "carrito", "Carrito");
  await page.getByRole("link", { name: "Continuar al pago" }).click();
  await expect(page.getByRole("heading", { name: "Finalizar compra", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Email" }).fill(buyer);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Teléfono/).fill("222.123.4567");
  await page.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Puebla");
  await page.getByLabel("Código postal").fill("72000");
  await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("Puebla");
  const confirm = page.getByRole("button", { name: /Confirmar pedido/ });
  const pay = page.getByRole("heading", { name: "Pago de prueba" });
  await confirm.click();
  await expect(pay.or(page.getByText(/Elegimos «/))).toBeVisible();
  if (!(await pay.isVisible())) {
    if (phone) {
      await phoneCheck(page, "checkout con envío elegido");
      await shot(page, "celular-checkout", "Celular: checkout con envío elegido");
    } else await shot(page, "checkout", "Datos del cliente y envío elegido, con el total");
    await confirm.click();
  }
  await expect(pay).toBeVisible();
  if (phone) await phoneCheck(page, "pantalla de pago");
  else await shot(page, "pago-de-prueba", "Pantalla del pago de prueba (proveedor simulado)");
  if (!approve) return;
  await page.getByRole("button", { name: "Aprobar pago" }).click();
  await expect(page.getByRole("heading", { name: "Gracias por tu compra" })).toBeVisible();
  if (phone) await phoneCheck(page, "gracias por tu compra");
  else await shot(page, "regreso-a-la-tienda", "Regreso a la tienda: pedido pagado");
}

test.afterAll(() => {
  writeFileSync(join(OUT, "registro.txt"), `${log.join("\n")}\n`);
});

test("1. compra completa en la computadora y correo de confirmación", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await buy(page, false, true);
  const [o] = await admin<
    { id: string; display_number: string; status: string; payment_status: string; total: string }[]
  >`
    select o.id, o.display_number, o.status, o.payment_status, o.total from public.orders o
      join public.stores s on s.id = o.store_id
     where s.handle = 'demo2' and o.email = ${buyer} order by o.created_at desc limit 1`;
  orderId = o!.id;
  orderNumber = o!.display_number;
  note(
    `   pedido ${o!.display_number}: ${o!.status} / ${o!.payment_status}, total ${o!.total} centavos`,
  );
  await runJobs();
  const m = await mail(buyer, /Confirmamos tu pedido/);
  note(
    `   correo «${m.Subject}» (envíos: ${m.count}); lleva número: ${m.Text.includes(o!.display_number)}, dirección: ${m.Text.includes("Av. Juárez 10")}`,
  );
  await showMail(page, m.HTML, "correo-confirmacion", `Correo de confirmación a ${buyer}`);
});

test("2. panel: pedido, envío con guía, correo de envío, pendientes y cancelación", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Un segundo pedido que se queda sin pagar (el cliente cerró la ventana).
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await buy(other, false, false);
  await ctx.close();

  await loginNewStaff(page, OWNER);
  await page.goto(`/admin/demo2/pedidos`);
  await expect(page.getByText(orderNumber).first()).toBeVisible();
  await shot(page, "panel-pedidos", "Panel: lista de pedidos");
  await page.goto(`/admin/demo2/pedidos/${orderId}`);
  await expect(page.getByText("Av. Juárez 10").first()).toBeVisible();
  await shot(page, "panel-detalle", "Panel: detalle con estado, dirección, productos y total");

  for (const unit of await page.getByLabel(/^Unidades de /).all()) {
    const max = await unit.getAttribute("max");
    if (max) await unit.fill(max);
  }
  await page
    .getByLabel(/^Paquetería/)
    .first()
    .fill("Estafeta");
  await page.getByLabel(/Número de guía/).fill("EST123456789MX");
  await page.getByRole("button", { name: "Registrar envío" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Envío registrado." })).toBeVisible();
  await shot(page, "panel-enviado", "Panel: envío registrado con paquetería y guía");
  await runJobs();
  const shipped = await mail(buyer, /va en camino/);
  note(`   correo «${shipped.Subject}»; lleva la guía: ${shipped.Text.includes("EST123456789MX")}`);
  await showMail(page, shipped.HTML, "correo-envio", "Correo de envío al cliente");

  await page.goto(`/admin/demo2/pedidos?estado=pendientes`);
  await shot(page, "panel-pendientes", "Panel: pedidos pendientes de pago");
  await page.locator('a[href*="/admin/demo2/pedidos/"]').first().click();
  await page.getByText("Cancelar el pedido").click();
  const cancel = page.getByRole("button", { name: "Cancelar pedido" });
  const ack = page.getByLabel(/Entiendo que/);
  if (await ack.count()) await ack.check();
  await cancel.click();
  const ok = page.getByRole("status").filter({ hasText: "Pedido cancelado." });
  const askAgain = page.getByRole("alert").filter({ hasText: "Confirma" });
  await expect(ok.or(askAgain)).toBeVisible();
  if (await askAgain.isVisible()) {
    await ack.check();
    await cancel.click();
  }
  await expect(ok).toBeVisible();
  await shot(page, "panel-cancelado", "Panel: pedido pendiente cancelado");

  // El panel en el celular.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, where] of [
    ["/admin/demo2", "panel: inicio"],
    ["/admin/demo2/pedidos", "panel: pedidos"],
    [`/admin/demo2/pedidos/${orderId}`, "panel: detalle del pedido"],
    ["/admin/demo2/pedidos?estado=pendientes", "panel: pendientes"],
  ] as const) {
    await page.goto(path);
    await phoneCheck(page, where);
  }
  await shot(page, "celular-panel-pendientes", "Celular: panel, pendientes");
  await page.goto(`/admin/demo2/pedidos/${orderId}`);
  await shot(page, "celular-panel-detalle", "Celular: panel, detalle del pedido");
});

test("3. la compra completa en el celular", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await buy(page, true, true);
  await shot(page, "celular-gracias", "Celular: compra terminada");
  await ctx.close();
});
