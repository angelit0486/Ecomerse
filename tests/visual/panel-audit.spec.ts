import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";

import { admin, loginNewStaff } from "../e2e/support";

/**
 * Auditoría del panel de `demo2` (stack local, `pnpm demo:seed:neutral`): cada
 * pantalla en celular (375 px) y computadora (1280 px). Anota errores de carga y
 * de consola, desborde horizontal, problemas serios de accesibilidad (axe) y
 * botones o enlaces de menos de 24 px (WCAG 2.5.8). Escribe un informe en
 * $PANEL_AUDIT_OUT (por defecto docs/audit/panel). No forma parte de test:e2e.
 * La dueña local de demo2 no debe tener 2FA (loginNewStaff la enrola).
 */
const OUT = process.env.PANEL_AUDIT_OUT ?? "docs/audit/panel";
const OWNER = "demo2@example.test";

interface Finding {
  path: string;
  width: number;
  status: number | null;
  errorShown: boolean;
  consoleErrors: string[];
  overflow: number;
  culprits: string[];
  axe: string[];
  smallTargets: string[];
}

async function audit(page: Page, path: string, width: number): Promise<Finding> {
  const consoleErrors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
  };
  page.on("console", onConsole);
  await page.setViewportSize({ width, height: 900 });
  const res = await page.goto(path, { waitUntil: "load", timeout: 30_000 }).catch(() => null);
  const info = await page.evaluate(() => {
    const small = [
      ...document.querySelectorAll<HTMLElement>("main a, main button, main [role=button]"),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden") return false;
        // Enlaces dentro de un párrafo son la excepción de WCAG 2.5.8.
        if (e.tagName === "A" && e.closest("p, li") && r.height >= 16) return false;
        return r.width < 24 || r.height < 24;
      })
      .slice(0, 6)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()} «${(e.textContent ?? e.getAttribute("aria-label") ?? "").trim().slice(0, 30)}»`,
      );
    const w = window.innerWidth;
    const culprits =
      document.documentElement.scrollWidth > w
        ? [...document.querySelectorAll<HTMLElement>("body *")]
            .filter((e) => e.getBoundingClientRect().right > w + 0.5 && e.children.length === 0)
            .slice(0, 3)
            .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)}`)
        : [];
    return {
      culprits,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      errorShown: /Algo salió mal|Error inesperado|Application error/i.test(
        document.body.innerText,
      ),
      small,
    };
  });
  await page.evaluate(
    readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8"),
  );
  const axeIds = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            c: Document,
            o: object,
          ) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] },
    });
    return r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.nodes.length})`);
  });
  page.off("console", onConsole);
  return {
    path,
    width,
    status: res?.status() ?? null,
    errorShown: info.errorShown,
    consoleErrors,
    overflow: info.overflow,
    culprits: info.culprits,
    axe: axeIds,
    smallTargets: info.small,
  };
}

test("auditoría del panel de demo2", async ({ page }) => {
  test.setTimeout(2_400_000);
  await admin`delete from auth.mfa_factors where user_id = (select id from auth.users where email = ${OWNER})`;
  await loginNewStaff(page, OWNER);
  const [ids] = await admin<
    { product: string; order: string; customer: string; variant: string; page: string }[]
  >`
    select (select id::text from public.products where store_id = s.id order by created_at limit 1) product,
           (select id::text from public.orders where store_id = s.id order by created_at desc limit 1) "order",
           (select id::text from public.customers where store_id = s.id order by created_at limit 1) customer,
           (select id::text from public.product_variants where store_id = s.id order by created_at limit 1) variant,
           (select id::text from public.store_pages where store_id = s.id order by created_at limit 1) page
      from public.stores s where s.handle = 'demo2'`;
  const b = "/admin/demo2";
  const paths = [
    "",
    "/pedidos",
    "/pedidos?estado=por-surtir",
    "/pedidos/despachos",
    `/pedidos/${ids!.order}`,
    "/productos",
    "/productos/nuevo",
    `/productos/${ids!.product}`,
    "/productos/categorias",
    "/productos/marcas",
    "/productos/atributos",
    "/productos/ofertas",
    "/productos/ofertas/nueva",
    "/productos/opiniones",
    "/productos/proveedores",
    "/productos/revision",
    "/productos/importar",
    "/productos/importar/imagenes",
    "/inventario",
    `/inventario/${ids!.variant}`,
    "/clientes",
    `/clientes/${ids!.customer}`,
    "/descuentos",
    "/envios",
    "/impuestos",
    "/apariencia",
    "/apariencia?seccion=portada",
    "/contenido",
    "/contenido/menus",
    "/contenido/redirecciones",
    `/contenido/paginas/${ids!.page}`,
    "/configuracion",
    "/ajustes/tienda",
    "/ajustes/pagos",
    "/ajustes/equipo",
    "/ajustes/notificaciones",
    "/ajustes/funciones",
    "/ajustes/cumplimiento",
    "/ajustes/plan",
    "/ajustes/actividad",
    "/ajustes/exportar",
    "/ajustes/dominio",
  ].filter((p) => !p.includes("undefined") && !p.endsWith("/null"));

  const findings: Finding[] = [];
  for (const p of paths) {
    for (const w of [375, 1280]) findings.push(await audit(page, `${b}${p}`, w));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "auditoria.json"), JSON.stringify(findings, null, 2));
  }
  const problems = findings.filter(
    (f) =>
      (f.status ?? 0) >= 400 ||
      f.errorShown ||
      f.consoleErrors.length ||
      f.overflow > 0 ||
      f.axe.length ||
      f.smallTargets.length,
  );
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "auditoria.json"), JSON.stringify(findings, null, 2));
  const lines = problems.map(
    (f) =>
      `- ${f.path} @${f.width}px: ${[
        (f.status ?? 0) >= 400 ? `HTTP ${f.status}` : "",
        f.errorShown ? "pantalla de error" : "",
        f.consoleErrors.length ? `consola: ${f.consoleErrors.join(" | ")}` : "",
        f.overflow > 0 ? `desborde ${f.overflow}px (${f.culprits.join(", ")})` : "",
        f.axe.length ? `axe: ${f.axe.join(", ")}` : "",
        f.smallTargets.length ? `objetivos < 24px: ${f.smallTargets.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ")}`,
  );
  writeFileSync(
    join(OUT, "resumen.txt"),
    `${paths.length} pantallas × 2 anchos = ${findings.length} revisiones; con hallazgos: ${problems.length}\n${lines.join("\n")}\n`,
  );
});
