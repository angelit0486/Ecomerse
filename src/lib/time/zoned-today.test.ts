import { describe, expect, it } from "vitest";

import { zonedToday } from "./zoned-today";

describe("zonedToday", () => {
  it("de noche en Hermosillo (UTC−7) todavía es «hoy» aunque en UTC ya sea mañana", () => {
    const now = new Date("2026-11-17T03:30:00Z"); // 16 nov, 20:30 en Hermosillo
    expect(zonedToday("America/Hermosillo", now)).toBe("2026-11-16");
    expect(zonedToday("UTC", now)).toBe("2026-11-17");
  });

  it("en zonas positivas el día empieza antes que en UTC", () => {
    const now = new Date("2026-11-16T23:30:00Z");
    expect(zonedToday("Europe/Madrid", now)).toBe("2026-11-17");
    expect(zonedToday("America/Mexico_City", now)).toBe("2026-11-16");
  });

  it("cruza fin de año y usa siempre el formato AAAA-MM-DD", () => {
    expect(zonedToday("America/Mexico_City", new Date("2027-01-01T05:59:59Z"))).toBe("2026-12-31");
    expect(zonedToday("America/Mexico_City", new Date("2027-01-01T06:00:00Z"))).toBe("2027-01-01");
  });
});
