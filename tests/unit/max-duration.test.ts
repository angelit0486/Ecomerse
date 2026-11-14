import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D8 / M2 (auditoría del bloque 2, Orden 10, mensaje 5). Una página o ruta que
 * arranca la cola (`resumeQueue` o `processQueueSoon`) corre, después de
 * responder, una pasada del runner de hasta 55 s (`runQueuedJobs`). Debe
 * declarar `maxDuration = 60`, el mismo límite que /api/jobs/run: con el límite
 * por omisión de la plataforma la pasada podría cortarse a la mitad.
 */
const APP = join(process.cwd(), "src/app");
const RUNNER = readFileSync(join(process.cwd(), "src/server/jobs/run-now.ts"), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const entries = files(APP).filter((f) => /\/(page\.tsx|route\.ts)$/.test(f));
const queueing = entries.filter((f) =>
  /\b(resumeQueue|processQueueSoon)\(/.test(readFileSync(f, "utf8")),
);

describe("límite de ejecución de las páginas que corren la cola", () => {
  it("encuentra las páginas que arrancan la cola (incluidas las 5 de la auditoría)", () => {
    const rel = queueing.map((f) => f.slice(APP.length + 1));
    for (const page of [
      "admin/[storeHandle]/productos/importar/page.tsx",
      "admin/[storeHandle]/productos/importar/fotos/page.tsx",
      "admin/[storeHandle]/productos/[productId]/page.tsx",
      "admin/[storeHandle]/page.tsx",
      "admin/[storeHandle]/pedidos/page.tsx",
    ]) {
      expect(rel).toContain(page);
    }
  });

  it.each(queueing.map((f) => [f.slice(APP.length + 1), f]))(
    "%s declara maxDuration = 60",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).toMatch(/^export const maxDuration = 60;$/m);
    },
  );

  it("la pasada del runner cabe en esos 60 s (tope duro 55 s)", () => {
    expect(RUNNER).toMatch(/hardDeadlineMs: 55_000/);
    expect(RUNNER).toMatch(/deadlineMs: 45_000/);
    const route = readFileSync(join(APP, "api/jobs/run/route.ts"), "utf8");
    expect(route).toMatch(/^export const maxDuration = 60;$/m);
    // El cron versionado apunta a ese endpoint.
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string }[];
    };
    expect(vercel.crons.map((c) => c.path)).toEqual(["/api/jobs/run"]);
  });
});
