import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ queue: [] as string[], blocked: false, status: "pending" }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/jobs/run-now", () => ({
  processQueueSoon: (reason: string) => calls.queue.push(reason),
}));
vi.mock("@/server/system/health", () => ({ imageProcessingBlocked: () => calls.blocked }));
vi.mock("./upload", () => ({
  finalizeMediaUpload: async () => ({ status: calls.status }),
}));

const { finalizePanelUpload } = await import("./finalize");
const supabase = {} as never;

describe("finalizePanelUpload", () => {
  beforeEach(() => {
    calls.queue = [];
    calls.blocked = false;
    calls.status = "pending";
  });

  it("una imagen en espera arranca la cola en cuanto termina la respuesta", async () => {
    await finalizePanelUpload(supabase, "s", "m", "appearance.banner");
    expect(calls.queue).toEqual(["appearance.banner"]);
  });

  it("si ya quedó lista o rechazada no hay nada que procesar", async () => {
    calls.status = "ready";
    await finalizePanelUpload(supabase, "s", "m", "x");
    calls.status = "rejected";
    await finalizePanelUpload(supabase, "s", "m", "x");
    expect(calls.queue).toEqual([]);
  });

  it("sin la clave de Storage no gasta un intento", async () => {
    calls.blocked = true;
    await finalizePanelUpload(supabase, "s", "m", "x");
    expect(calls.queue).toEqual([]);
  });
});

/** Todos los .ts/.tsx bajo un directorio. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("toda subida del panel arranca la cola", () => {
  it("ninguna pantalla llama a finalizeMediaUpload directo (banner, logo, marcas, categorías, productos)", () => {
    const offenders = files(join(process.cwd(), "src/app")).filter((path) =>
      /\bfinalizeMediaUpload\b/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
