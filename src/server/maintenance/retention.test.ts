import { describe, expect, it } from "vitest";

import type { Sql } from "@/server/db/role-clients";
import type { JobRecord } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";

import { createRetentionHandlers, MAX_RETENTION_BATCHES, type RetentionResult } from "./retention";

const job: JobRecord = {
  id: "j1",
  type: "data.retention",
  storeId: null,
  payload: {},
  attempts: 1,
  maxAttempts: 3,
};

function result(over: Partial<RetentionResult> = {}): RetentionResult {
  return {
    jobs: 0,
    import_jobs: 0,
    import_rows: 0,
    notifications: 0,
    carts: 0,
    more: false,
    ...over,
  };
}

/** Base falsa: cada llamada a system.purge_retention devuelve el siguiente lote. */
function fakeDb(batches: RetentionResult[]) {
  const queries: string[] = [];
  const db = ((strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    const r = batches[queries.length - 1] ?? result();
    return Promise.resolve([{ r }]);
  }) as unknown as Sql;
  return { db, queries };
}

async function run(db: Sql, deadline = Date.now() + 60_000) {
  const lines: string[] = [];
  const handler = new Map(createRetentionHandlers({ db })).get("data.retention")!;
  await handler(job, { log: createLogger({ sink: (l) => lines.push(l) }), deadline });
  return lines.join("\n");
}

describe("data.retention (ADR-060)", () => {
  it("una corrida sin pendientes llama una vez y registra los totales", async () => {
    const { db, queries } = fakeDb([result({ jobs: 4, carts: 2 })]);
    const log = await run(db);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("system.purge_retention()");
    expect(log).toContain('"jobs":4');
    expect(log).toContain('"carts":2');
    expect(log).toContain('"pending":false');
  });

  it("repite mientras quede trabajo y suma los lotes", async () => {
    const { db, queries } = fakeDb([
      result({ notifications: 5000, more: true }),
      result({ notifications: 1200, carts: 3 }),
    ]);
    const log = await run(db);
    expect(queries).toHaveLength(2);
    expect(log).toContain('"notifications":6200');
    expect(log).toContain('"batches":2');
  });

  it("no pasa del tope de lotes aunque siga habiendo trabajo", async () => {
    const { db, queries } = fakeDb(
      Array.from({ length: 50 }, () => result({ carts: 5000, more: true })),
    );
    const log = await run(db);
    expect(queries).toHaveLength(MAX_RETENTION_BATCHES);
    expect(log).toContain('"pending":true');
  });

  it("sin tiempo en la ejecución corre un solo lote", async () => {
    const { db, queries } = fakeDb([result({ more: true }), result({ more: true })]);
    await run(db, Date.now() - 1);
    expect(queries).toHaveLength(1);
  });

  it("una respuesta inesperada de la base falla el trabajo (se reintenta)", async () => {
    const db = (() => Promise.resolve([{ r: { jobs: "x" } }])) as unknown as Sql;
    await expect(run(db)).rejects.toThrow();
  });
});
