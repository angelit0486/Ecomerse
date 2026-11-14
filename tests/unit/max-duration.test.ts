import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createQueueGraph } from "./queue-entry-graph";

/**
 * D8 / M2 (Orden 10, mensaje 5) y H3 (mensaje 7). Una página o ruta que arranca
 * la cola corre, después de responder, una pasada del runner de hasta 55 s
 * (`runQueuedJobs`). Debe declarar `maxDuration = 60`, el mismo límite que
 * /api/jobs/run. Se detectan también las llamadas indirectas: acción de servidor
 * usada por un componente de la página, helper (`finalizePanelUpload`) o layout.
 * El límite real depende del plan de Vercel (docs/runbooks/operacion-de-colas.md §2).
 */
const SEED = {
  file: "server/jobs/run-now.ts",
  names: ["processQueueSoon", "resumeQueue", "runQueuedJobs"],
};
const graph = createQueueGraph(join(process.cwd(), "src"), SEED);
const queueing = graph.queueEntries();
const queueingNames = queueing.map((q) => q.entry);

/** Entradas con 60 s por otra razón (no arrancan la cola). */
const OTHER_REASONS: Record<string, string> = {
  "app/admin/[storeHandle]/productos/importar/lote/[batchId]/parte/[part]/route.ts":
    "planear y validar una parte de 5,000 filas (D8)",
};

describe("límite de ejecución de las páginas que corren la cola", () => {
  it("encuentra las entradas de la auditoría (M2 y H3), directas e indirectas", () => {
    for (const entry of [
      // M2: llamada directa en la página.
      "app/admin/[storeHandle]/productos/importar/page.tsx",
      "app/admin/[storeHandle]/productos/importar/fotos/page.tsx",
      "app/admin/[storeHandle]/productos/[productId]/page.tsx",
      "app/admin/[storeHandle]/page.tsx",
      "app/admin/[storeHandle]/pedidos/page.tsx",
      // H3: por una acción o por finalizePanelUpload.
      "app/admin/[storeHandle]/configuracion/page.tsx",
      "app/admin/[storeHandle]/productos/importar/imagenes/page.tsx",
      "app/admin/[storeHandle]/apariencia/page.tsx",
      "app/platform/trabajos/page.tsx",
      "app/admin/tiendas/nueva/page.tsx",
      "app/admin/[storeHandle]/ajustes/dominio/page.tsx",
      "app/%5Fstore/[storeId]/checkout/page.tsx",
    ]) {
      expect(queueingNames).toContain(entry);
    }
  });

  it.each(queueing.map((q) => [q.entry, q.chain.join(" → ")]))(
    "%s declara maxDuration = 60",
    (entry, chain) => {
      expect(graph.declaresMaxDuration(entry), `arranca la cola: ${chain}`).toBe(true);
    },
  );

  it("ninguna otra entrada declara 60 s sin una razón escrita (sin falsos positivos)", () => {
    const declared = graph
      .entries()
      .map((f) => f.slice(join(process.cwd(), "src").length + 1))
      .filter((entry) => graph.declaresMaxDuration(entry));
    const unexplained = declared.filter((e) => !queueingNames.includes(e) && !OTHER_REASONS[e]);
    expect(unexplained).toEqual([]);
  });

  it("no marca las páginas que solo usan otra acción del mismo módulo", () => {
    // El carrito y los listados usan addItem (carrito/actions.ts), que no arranca la cola.
    for (const entry of [
      "app/%5Fstore/[storeId]/carrito/page.tsx",
      "app/%5Fstore/[storeId]/productos/[slug]/page.tsx",
      "app/%5Fstore/[storeId]/robots.txt/route.ts",
    ]) {
      expect(queueingNames).not.toContain(entry);
    }
  });

  it("la pasada del runner cabe en esos 60 s (tope duro 55 s)", () => {
    const runner = readFileSync(join(process.cwd(), "src/server/jobs/run-now.ts"), "utf8");
    expect(runner).toMatch(/hardDeadlineMs: 55_000/);
    expect(runner).toMatch(/deadlineMs: 45_000/);
    expect(graph.declaresMaxDuration("app/api/jobs/run/route.ts")).toBe(true);
    // El cron versionado apunta a ese endpoint y sigue siendo diario (H1: no se
    // activa «cada minuto» sin autorización).
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toEqual([{ path: "/api/jobs/run", schedule: "0 12 * * *" }]);
  });
});

describe("detector de entradas (caso negativo con un árbol de prueba)", () => {
  const root = mkdtempSync(join(tmpdir(), "queue-graph-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, body: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  put(
    "server/jobs/run-now.ts",
    "export function processQueueSoon(reason: string) {}\nexport function resumeQueue(r: string) {}\nexport function runQueuedJobs() {}\n",
  );
  put(
    "server/helper.ts",
    'import { processQueueSoon } from "@/server/jobs/run-now";\nexport function finish() {\n  processQueueSoon("x");\n}\n',
  );
  put(
    "app/tienda/actions.ts",
    '"use server";\nimport { finish } from "@/server/helper";\nexport async function pay() {\n  finish();\n}\nexport async function addItem() {\n  return "processQueueSoon(";\n}\n',
  );
  put(
    "app/tienda/pay-form.tsx",
    '"use client";\nimport { pay } from "./actions";\nexport function PayForm() {\n  return <form action={pay} />;\n}\n',
  );
  put(
    "app/tienda/add-form.tsx",
    '"use client";\nimport { addItem } from "./actions";\nexport function AddForm() {\n  return <form action={addItem} />;\n}\n',
  );
  // Indirecta y sin límite: debe detectarse.
  put(
    "app/tienda/pagar/page.tsx",
    'import { PayForm } from "../pay-form";\nexport default function Page() {\n  return <PayForm />;\n}\n',
  );
  // Misma acción con su límite: correcta.
  put(
    "app/tienda/pagar-bien/page.tsx",
    'import { PayForm } from "../pay-form";\nexport const maxDuration = 60;\nexport default function Page() {\n  return <PayForm />;\n}\n',
  );
  // Otra acción del mismo módulo (y el texto «processQueueSoon(» en una cadena): no cuenta.
  put(
    "app/tienda/carrito/page.tsx",
    'import { AddForm } from "../add-form";\nexport default function Page() {\n  return <AddForm />;\n}\n',
  );
  // Layout que arranca la cola: cuenta para sus páginas, no para sus rutas.
  put(
    "app/panel/layout.tsx",
    'import { PayForm } from "../tienda/pay-form";\nexport default function Layout({ children }: { children: unknown }) {\n  return <>{children}<PayForm /></>;\n}\n',
  );
  put("app/panel/page.tsx", "export default function Page() {\n  return null;\n}\n");
  put("app/panel/icon.svg/route.ts", "export function GET() {\n  return new Response();\n}\n");
  // Import dinámico.
  put(
    "app/api/x/route.ts",
    'export async function POST() {\n  const { finish } = await import("@/server/helper");\n  finish();\n}\n',
  );

  const fixture = createQueueGraph(root, SEED);
  const found = fixture.queueEntries();

  it("detecta las llamadas indirectas (acción, helper, layout, import dinámico)", () => {
    expect(found.map((q) => q.entry).sort()).toEqual([
      "app/api/x/route.ts",
      "app/panel/page.tsx",
      "app/tienda/pagar-bien/page.tsx",
      "app/tienda/pagar/page.tsx",
    ]);
    expect(found.find((q) => q.entry === "app/tienda/pagar/page.tsx")!.chain).toEqual([
      "app/tienda/pagar/page.tsx#Page",
      "app/tienda/pay-form.tsx#PayForm",
      "app/tienda/actions.ts#pay",
      "server/helper.ts#finish",
      "server/jobs/run-now.ts#processQueueSoon",
    ]);
  });

  it("reporta la página sin límite y acepta la que lo tiene", () => {
    const missing = found.filter((q) => !fixture.declaresMaxDuration(q.entry)).map((q) => q.entry);
    expect(missing).toContain("app/tienda/pagar/page.tsx");
    expect(missing).not.toContain("app/tienda/pagar-bien/page.tsx");
  });
});
