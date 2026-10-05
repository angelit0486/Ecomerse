import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";

/**
 * Integración real contra PostgreSQL con el rol system_worker (sin acceso a tablas).
 * Ejecutar con `pnpm db:test`, que prepara la base y define estas variables.
 */
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
if (!adminUrl || !workerUrl) {
  throw new Error(
    "Faltan TEST_ADMIN_DATABASE_URL / TEST_WORKER_DATABASE_URL. Ejecuta `pnpm db:test`.",
  );
}

const admin = postgres(adminUrl, { max: 2, onnotice: () => {} });
const worker = postgres(workerUrl, { max: 6, prepare: false, onnotice: () => {} });
const store = createPostgresJobStore(worker);
const silent = createLogger({ sink: () => {} });

async function enqueue(type: string, count = 1) {
  for (let i = 0; i < count; i += 1) {
    await admin`select app.enqueue_job(${type}, '{}'::jsonb, null, null, now() - interval '1 second')`;
  }
}

beforeEach(async () => {
  await admin`delete from system.jobs`;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("cola de jobs (system_worker)", () => {
  it("varios workers concurrentes nunca reclaman el mismo job", async () => {
    await enqueue("test.concurrent", 40);
    const batches = await Promise.all(
      ["w1", "w2", "w3", "w4", "w5"].map((id) => store.claim(id, 10)),
    );
    const ids = batches.flat().map((job) => job.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  });

  it("el runner aplica éxito, reintento con backoff y fallos permanentes en la base", async () => {
    await enqueue("test.ok");
    await enqueue("test.flaky");
    await enqueue("test.fatal");
    await enqueue("test.unknown");
    const registry = new Map<string, JobHandler>([
      ["test.ok", async () => {}],
      [
        "test.flaky",
        async () => {
          throw new Error("timeout de proveedor para ana@example.com");
        },
      ],
      [
        "test.fatal",
        async () => {
          throw new PermanentJobError("payload inválido");
        },
      ],
    ]);

    const result = await runJobs({ store, registry, workerId: "it-worker", log: silent });
    expect(result).toEqual({ claimed: 4, succeeded: 1, retried: 1, dead: 2 });

    const rows = await admin<
      { type: string; status: string; attempts: number; last_error: string | null; delay: number }[]
    >`
      select type, status, attempts, last_error,
             extract(epoch from (run_after - now()))::int as delay
        from system.jobs order by type`;
    const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
    expect(byType["test.ok"]).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(byType["test.flaky"]).toMatchObject({ status: "queued", attempts: 1 });
    expect(byType["test.flaky"]!.last_error).toBe("Error: timeout de proveedor para [email]");
    expect(byType["test.flaky"]!.delay).toBeGreaterThanOrEqual(55);
    expect(byType["test.fatal"]).toMatchObject({ status: "dead" });
    expect(byType["test.unknown"]).toMatchObject({
      status: "dead",
      last_error: "unknown_job_type",
    });
  });

  it("system_worker no puede leer ni modificar la tabla directamente", async () => {
    await expect(worker`select * from system.jobs`).rejects.toMatchObject({ code: "42501" });
    await expect(worker`delete from system.jobs`).rejects.toMatchObject({ code: "42501" });
    await expect(worker`select app.enqueue_job('test.x', '{}'::jsonb)`).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("health_check responde con el rol system_worker", async () => {
    const [row] = await worker<{ health: { db: boolean; dead_jobs: number } }[]>`
      select system.health_check() as health`;
    expect(row!.health.db).toBe(true);
  });
});
