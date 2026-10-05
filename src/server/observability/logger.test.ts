import { describe, expect, it } from "vitest";

import { createLogger } from "./logger";

function capture(level: "debug" | "info" | "warn" | "error" = "info") {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level,
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date("2026-10-05T00:00:00.000Z"),
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("escribe JSON estructurado con nivel, mensaje y campos", () => {
    const { logger, lines } = capture();
    logger.info("Pedido creado", { order_id: "o1" });
    expect(lines).toEqual([
      { ts: "2026-10-05T00:00:00.000Z", level: "info", msg: "Pedido creado", order_id: "o1" },
    ]);
  });

  it("respeta el nivel mínimo", () => {
    const { logger, lines } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("redacta campos, mensaje y campos base de loggers hijos", () => {
    const { logger, lines } = capture();
    logger
      .child({ request_id: "r1", token: "t" })
      .warn("Login fallido de ana@example.com", { email: "ana@example.com", attempt: 2 });
    const line = lines[0]!;
    expect(line.msg).toBe("Login fallido de [email]");
    expect(line.request_id).toBe("r1");
    expect(line.token).toBe("[redactado]");
    expect(line.email).toBe("[redactado]");
    expect(line.attempt).toBe(2);
    expect(JSON.stringify(line)).not.toContain("ana@example.com");
  });
});
