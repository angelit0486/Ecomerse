import { beforeEach, describe, expect, it, vi } from "vitest";

const authorize = vi.fn();
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ CRON_SECRET: "c".repeat(32), JOBS_HMAC_SECRET: "h".repeat(32) }),
}));
vi.mock("@/server/jobs/authorize", () => ({ authorizeJobRunner: (i: unknown) => authorize(i) }));
vi.mock("@/server/db/role-clients", () => ({ workerDb: () => vi.fn() }));
vi.mock("@/server/jobs/run-now", () => ({ runQueuedJobs: vi.fn() }));

import { POST } from "./route";

const url = "https://app.pruva.test/api/jobs/run";

describe("runner de jobs: tope de cuerpo antes de autenticar", () => {
  beforeEach(() => authorize.mockReset());

  it("rechaza con 413 un cuerpo grande sin llegar a autenticar", async () => {
    const res = await POST(new Request(url, { method: "POST", body: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("un cuerpo pequeño sigue pasando por la autenticación (y sin firma da 401)", async () => {
    authorize.mockReturnValue({ ok: false });
    const res = await POST(new Request(url, { method: "POST", body: "{}" }));
    expect(authorize).toHaveBeenCalledOnce();
    expect(res.status).toBe(401);
  });
});
