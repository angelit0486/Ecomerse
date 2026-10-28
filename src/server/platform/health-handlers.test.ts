import { describe, expect, it } from "vitest";

import { fakeChannel } from "@/server/notifications/channels";
import { createLogger } from "@/server/observability/logger";

import { createHealthHandlers } from "./health-handlers";

const healthy = {
  checked_at: "2026-10-28T10:00:00Z",
  status: "ok",
  issues: [],
  queue: { oldest_ready_seconds: 0, stuck: 0, dead_24h: 0, dead_by_type: {} },
  payments: { events_24h: 0, events_failed_24h: 0, webhooks_rejected_24h: 0, open_over_2h: 0 },
  emails: { sent_24h: 0, suppressed_24h: 0 },
  orders_24h: 0,
};

/** Base falsa: responde según la consulta y anota cuáles se hicieron. */
function fakeDb(health: unknown) {
  const queries: string[] = [];
  const db = (async (strings: TemplateStringsArray) => {
    const q = strings.join("?");
    queries.push(q);
    if (q.includes("platform_health")) return [{ h: health }];
    return [];
  }) as never;
  return { db, queries };
}

const log = createLogger({ sink: () => {} });

describe("platform.health_check", () => {
  it("sin problemas no busca destinatarios ni envía nada", async () => {
    const channel = fakeChannel();
    const { db, queries } = fakeDb(healthy);
    const [check] = createHealthHandlers({ db, channel, appUrl: "https://panel.test" }).map(
      ([, h]) => h,
    );
    await check!({} as never, { log } as never);
    expect(channel.sent).toHaveLength(0);
    expect(queries.some((q) => q.includes("platform_alert_recipients"))).toBe(false);
  });

  it("rechaza una respuesta con forma inesperada en lugar de avisar a medias", async () => {
    const { db } = fakeDb({ status: "ok" });
    const [check] = createHealthHandlers({
      db,
      channel: fakeChannel(),
      appUrl: "https://panel.test",
    }).map(([, h]) => h);
    await expect(check!({} as never, { log } as never)).rejects.toThrow();
  });
});
