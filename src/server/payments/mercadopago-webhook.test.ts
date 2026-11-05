import { describe, expect, it } from "vitest";

import type { Sql } from "@/server/db/role-clients";
import { createLogger } from "@/server/observability/logger";

import { requestPendingNotice } from "./mercadopago-webhook";
import type { NormalizedPayment } from "./provider";

const pending = { status: "pending", method: "ticket" } as unknown as NormalizedPayment;

describe("aviso «pendiente de pago» (ADR-056; revisión 2026-11-05)", () => {
  it("si pedir el aviso falla, el cobro ya aplicado no se reporta como error", async () => {
    const lines: string[] = [];
    const db = (() => Promise.reject(new Error("statement timeout"))) as unknown as Sql;
    await expect(
      requestPendingNotice(db, "pay-1", pending, createLogger({ sink: (l) => lines.push(l) })),
    ).resolves.toBeUndefined();
    expect(lines.join("\n")).toContain("payment.pending_notice_failed");
  });

  it("solo se pide con un cobro pendiente y con medio", async () => {
    let calls = 0;
    const db = (() => {
      calls += 1;
      return Promise.resolve([]);
    }) as unknown as Sql;
    const log = createLogger({ sink: () => {} });
    await requestPendingNotice(db, "pay-1", { status: "approved", method: "ticket" } as never, log);
    await requestPendingNotice(db, "pay-1", { status: "pending", method: null } as never, log);
    expect(calls).toBe(0);
    await requestPendingNotice(db, "pay-1", pending, log);
    expect(calls).toBe(1);
  });
});
