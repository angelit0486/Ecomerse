import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("@/server/db/role-clients", () => ({ workerDb: () => sql }));
vi.mock("@/server/observability/logger", () => ({ log: { info: vi.fn(), error: vi.fn() } }));

import { READY_CACHE_MS, resetReadinessCache } from "@/server/health/readiness";

import { GET } from "./route";

const healthy = [{ health: { db: true, oldest_ready_seconds: 0, running_jobs: 0, dead_jobs: 0 } }];
const call = () => GET(new Request("https://app.test/api/health/ready"));

describe("readiness: una consulta a la base cada 5 s por instancia", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetReadinessCache();
    sql.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("llamadas seguidas reutilizan el último resultado", async () => {
    sql.mockResolvedValue(healthy);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect(sql).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + READY_CACHE_MS);
    await call();
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("llamadas simultáneas comparten una sola consulta", async () => {
    sql.mockResolvedValue(healthy);
    const responses = await Promise.all([call(), call(), call()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(sql).toHaveBeenCalledOnce();
  });

  it("si la base falla responde 503 y lo reutiliza solo durante la ventana", async () => {
    sql.mockRejectedValueOnce(new Error("down"));
    const r = await call();
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, data: { status: "degraded" } });
    vi.setSystemTime(Date.now() + READY_CACHE_MS);
    sql.mockResolvedValueOnce(healthy);
    expect((await call()).status).toBe(200);
  });
});
