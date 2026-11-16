import { describe, expect, it } from "vitest";

import { addDays, daysBetween, isIsoDay, zonedDayStart } from "./zoned-day";

describe("zoned-day", () => {
  it("isIsoDay valida fechas de calendario reales", () => {
    expect(isIsoDay("2026-03-10")).toBe(true);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("2026-3-1")).toBe(false);
    expect(isIsoDay(["2026-03-10"])).toBe(false);
    expect(isIsoDay(undefined)).toBe(false);
  });

  it("addDays y daysBetween", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-18", "2026-11-16")).toBe(29);
  });

  it("00:00 en CDMX (UTC−6, sin horario de verano) = 06:00Z, como dashboard_kpis", () => {
    expect(zonedDayStart("2026-03-10", "America/Mexico_City").toISOString()).toBe(
      "2026-03-10T06:00:00.000Z",
    );
  });

  it("UTC y zonas positivas", () => {
    expect(zonedDayStart("2026-03-10", "UTC").toISOString()).toBe("2026-03-10T00:00:00.000Z");
    expect(zonedDayStart("2026-03-10", "Europe/Madrid").toISOString()).toBe(
      "2026-03-09T23:00:00.000Z",
    );
  });

  it("cruza el cambio de horario (Nueva York, 8 de marzo de 2026)", () => {
    expect(zonedDayStart("2026-03-08", "America/New_York").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(zonedDayStart("2026-03-09", "America/New_York").toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });
});
