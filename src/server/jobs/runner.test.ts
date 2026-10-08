import { describe, expect, it } from "vitest";

import { createLogger } from "@/server/observability/logger";

import { runJobs } from "./runner";
import {
  DeferJobError,
  PermanentJobError,
  type JobHandler,
  type JobRecord,
  type JobStore,
} from "./types";

/** JobStore en memoria con la misma semántica observable que system.* */
function memoryStore(initial: Array<Pick<JobRecord, "id" | "type">>) {
  const jobs = initial.map((j) => ({
    ...j,
    storeId: null,
    payload: {},
    attempts: 0,
    maxAttempts: 3,
    status: "queued" as string,
    lastError: null as string | null,
  }));
  const store: JobStore = {
    async claim(_workerId, limit) {
      const ready = jobs.filter((j) => j.status === "queued").slice(0, limit);
      for (const j of ready) {
        j.status = "running";
        j.attempts += 1;
      }
      return ready.map(({ id, type, storeId, payload, attempts, maxAttempts }) => ({
        id,
        type,
        storeId,
        payload,
        attempts,
        maxAttempts,
      }));
    },
    async complete(id) {
      const j = jobs.find((x) => x.id === id)!;
      j.status = "succeeded";
      return true;
    },
    async release(id) {
      const j = jobs.find((x) => x.id === id)!;
      j.status = "queued";
      j.attempts -= 1;
      return true;
    },
    async fail(id, _workerId, error, permanent) {
      const j = jobs.find((x) => x.id === id)!;
      j.lastError = error;
      // En la base de datos el reintento espera run_after; aquí se marca "retry"
      // para no volver a reclamarlo en la misma ejecución.
      j.status = permanent || j.attempts >= j.maxAttempts ? "dead" : "retry";
      return j.status === "dead" ? "dead" : "queued";
    },
  };
  return { store, jobs };
}

const silent = createLogger({ sink: () => {} });

describe("runJobs", () => {
  it("ejecuta handlers, registra éxitos, reintentos y fallos permanentes", async () => {
    const { store, jobs } = memoryStore([
      { id: "1", type: "test.ok" },
      { id: "2", type: "test.flaky" },
      { id: "3", type: "test.fatal" },
      { id: "4", type: "test.unknown" },
    ]);
    const registry = new Map<string, JobHandler>([
      ["test.ok", async () => {}],
      [
        "test.flaky",
        async () => {
          throw new Error("timeout llamando a ana@example.com");
        },
      ],
      [
        "test.fatal",
        async () => {
          throw new PermanentJobError("payload inválido");
        },
      ],
    ]);

    const result = await runJobs({ store, registry, workerId: "w", log: silent });

    expect(result).toEqual({ claimed: 4, succeeded: 1, retried: 1, dead: 2, deferred: 0 });
    expect(jobs.map((j) => j.status)).toEqual(["succeeded", "retry", "dead", "dead"]);
    expect(jobs[1]!.lastError).toBe("Error: timeout llamando a [email]");
    expect(jobs[3]!.lastError).toBe("unknown_job_type");
  });

  it("se detiene al vencer el plazo aunque queden jobs", async () => {
    const { store } = memoryStore(
      Array.from({ length: 30 }, (_, i) => ({ id: String(i), type: "test.ok" })),
    );
    let clock = 0;
    const registry = new Map<string, JobHandler>([
      [
        "test.ok",
        async () => {
          clock += 100;
        },
      ],
    ]);
    const result = await runJobs({
      store,
      registry,
      workerId: "w",
      log: silent,
      batchSize: 5,
      deadlineMs: 1_000,
      now: () => clock,
    });
    expect(result.claimed).toBe(10);
    expect(result.succeeded).toBe(10);
  });

  it("termina cuando la cola está vacía", async () => {
    const { store } = memoryStore([]);
    expect(await runJobs({ store, registry: new Map(), workerId: "w", log: silent })).toEqual({
      claimed: 0,
      succeeded: 0,
      retried: 0,
      dead: 0,
      deferred: 0,
    });
  });

  it("aplaza sin gastar intentos lo que no cabe en el tiempo restante", async () => {
    const { store, jobs } = memoryStore([
      { id: "1", type: "test.ok" },
      { id: "2", type: "test.big" },
      { id: "3", type: "test.ok" },
    ]);
    let seenDeadline = 0;
    const registry = new Map<string, JobHandler>([
      ["test.ok", async () => {}],
      [
        "test.big",
        async (_job, context) => {
          seenDeadline = context.deadline;
          throw new DeferJobError();
        },
      ],
    ]);
    const result = await runJobs({
      store,
      registry,
      workerId: "w",
      log: silent,
      batchSize: 5,
      deadlineMs: 45_000,
      hardDeadlineMs: 55_000,
      now: () => 1_000,
    });
    expect(seenDeadline).toBe(56_000);
    expect(result).toMatchObject({ claimed: 3, succeeded: 1, deferred: 1 });
    // El aplazado y el que quedaba en el lote vuelven a la cola con sus intentos intactos.
    expect(jobs.map((j) => [j.id, j.status, j.attempts])).toEqual([
      ["1", "succeeded", 1],
      ["2", "queued", 0],
      ["3", "queued", 0],
    ]);
  });
});
