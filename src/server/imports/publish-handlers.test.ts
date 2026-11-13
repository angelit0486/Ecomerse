import { describe, expect, it, vi } from "vitest";

import type { Sql } from "@/server/db/role-clients";
import { DeferJobError, type JobRecord } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";

import { createPublishHandlers, MIN_PUBLISH_BUDGET_MS } from "./publish-handlers";

const RUN = "01890000-0000-7000-8000-000000000001";
const STORE = "01890000-0000-7000-8000-000000000002";
const job = {
  id: "j",
  type: "catalog.publish_run",
  storeId: STORE,
  payload: { run_id: RUN },
  attempts: 1,
  maxAttempts: 5,
} as unknown as JobRecord;
const log = createLogger({ sink: () => {} });

/** Base falsa: cada llamada a la tanda devuelve el siguiente resultado de la lista. */
function fakeDb(results: { status: string; processed: number; remaining: number }[]) {
  const calls: string[] = [];
  const tx = Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("publish_run_step")) {
      expect(values[0]).toBe(RUN);
      return [{ r: results.shift() }];
    }
    return [];
  }, {});
  const db = { begin: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as Sql;
  return { db, calls };
}

describe("catalog.publish_run", () => {
  it("sigue por tandas hasta que no queda nada y avisa a la tienda", async () => {
    const { db, calls } = fakeDb([
      { status: "running", processed: 200, remaining: 150 },
      { status: "completed", processed: 150, remaining: 0 },
    ]);
    const onPublished = vi.fn();
    const [, handler] = createPublishHandlers({ db, onPublished })[0]!;
    await handler(job, { log, deadline: Date.now() + 60_000 });
    expect(calls.filter((c) => c.includes("publish_run_step"))).toHaveLength(2);
    expect(onPublished).toHaveBeenCalledWith(STORE);
  });

  it("sin tiempo para otra tanda se aplaza (lo hecho ya quedó guardado)", async () => {
    let t = 0;
    const { db } = fakeDb([{ status: "running", processed: 200, remaining: 500 }]);
    const [, handler] = createPublishHandlers({
      db,
      now: () => (t += MIN_PUBLISH_BUDGET_MS),
    })[0]!;
    await expect(
      handler(job, { log, deadline: MIN_PUBLISH_BUDGET_MS * 2.5 }),
    ).rejects.toBeInstanceOf(DeferJobError);
  });

  it("una corrida ya terminada no hace nada más (idempotente)", async () => {
    const { db, calls } = fakeDb([{ status: "completed", processed: 0, remaining: 0 }]);
    const onPublished = vi.fn();
    const [, handler] = createPublishHandlers({ db, onPublished })[0]!;
    await handler(job, { log, deadline: Date.now() + 60_000 });
    expect(calls.filter((c) => c.includes("publish_run_step"))).toHaveLength(1);
    expect(onPublished).not.toHaveBeenCalled();
  });
});
