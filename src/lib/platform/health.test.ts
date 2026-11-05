import { describe, expect, it } from "vitest";

import { describeIssue, healthSchema } from "./health";

describe("salud: particiones de auditoría (auditoría global B1)", () => {
  it("aviso con los meses que quedan y urgente si hay registros fuera de partición", () => {
    expect(describeIssue({ code: "audit_partitions", severity: "warning", value: 2 }).title).toBe(
      "Quedan 2 mes(es) de particiones de auditoría",
    );
    expect(
      describeIssue({ code: "audit_partitions", severity: "critical", value: 0 }).title,
    ).toMatch(/fuera de su partición/);
  });

  it("acepta la salud con y sin el bloque de auditoría (bases anteriores)", () => {
    const base = {
      checked_at: "2026-11-05T00:00:00Z",
      status: "ok",
      issues: [],
      queue: { oldest_ready_seconds: 0, stuck: 0, dead_24h: 0, dead_by_type: {} },
      payments: { events_24h: 0, events_failed_24h: 0, webhooks_rejected_24h: 0, open_over_2h: 0 },
      emails: { sent_24h: 0, suppressed_24h: 0 },
      orders_24h: 0,
    };
    expect(healthSchema.safeParse(base).success).toBe(true);
    const withAudit = healthSchema.parse({
      ...base,
      audit: { months_ahead: 24, default_has_rows: false },
    });
    expect(withAudit.audit?.months_ahead).toBe(24);
  });
});

describe("salud: limpieza diaria de datos (ADR-060)", () => {
  it("dice cuántos días lleva sin correr y qué revisar", () => {
    const { title, action } = describeIssue({
      code: "retention_stale",
      severity: "warning",
      value: 9,
    });
    expect(title).toBe("La limpieza diaria de datos no corre desde hace 9 día(s)");
    expect(action).toMatch(/data\.retention/);
  });

  it("acepta el bloque de retención, también sin corrida registrada", () => {
    const base = {
      checked_at: "2026-11-05T00:00:00Z",
      status: "ok",
      issues: [],
      queue: { oldest_ready_seconds: 0, stuck: 0, dead_24h: 0, dead_by_type: {} },
      payments: { events_24h: 0, events_failed_24h: 0, webhooks_rejected_24h: 0, open_over_2h: 0 },
      emails: { sent_24h: 0, suppressed_24h: 0 },
      orders_24h: 0,
    };
    const retention = { payment_events_rows: 23, security_events_rows: 5528 };
    expect(
      healthSchema.parse({
        ...base,
        retention: { ...retention, last_run_at: "2026-11-05T00:00:00+00:00" },
      }).retention?.security_events_rows,
    ).toBe(5528);
    expect(
      healthSchema.parse({ ...base, retention: { ...retention, last_run_at: null } }).retention,
    ).toBeTruthy();
  });
});
