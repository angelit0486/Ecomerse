import { describe, expect, it } from "vitest";

import { parsePaidRange } from "./paid-range";

const TZ = "America/Mexico_City";

describe("parsePaidRange (filtro ?desde/&hasta de la lista de pedidos)", () => {
  it("rango válido: instantes UTC de los días de la tienda, fin exclusivo", () => {
    expect(parsePaidRange({ desde: "2026-03-10", hasta: "2026-03-10" }, TZ)).toEqual({
      from: "2026-03-10",
      to: "2026-03-10",
      start: "2026-03-10T06:00:00.000Z",
      end: "2026-03-11T06:00:00.000Z",
    });
  });
  it("sin fechas o con una sola: sin filtro", () => {
    expect(parsePaidRange({}, TZ)).toBeNull();
    expect(parsePaidRange({ desde: "2026-03-10" }, TZ)).toBeNull();
  });
  it("fechas inválidas, repetidas o con texto: sin filtro", () => {
    expect(parsePaidRange({ desde: "2026-02-30", hasta: "2026-03-10" }, TZ)).toBeNull();
    expect(parsePaidRange({ desde: ["2026-03-01"], hasta: "2026-03-10" }, TZ)).toBeNull();
    expect(parsePaidRange({ desde: "2026-03-01'),x", hasta: "2026-03-10" }, TZ)).toBeNull();
  });
  it("invertido o de más de 366 días: sin filtro (tope de dashboard_kpis)", () => {
    expect(parsePaidRange({ desde: "2026-03-10", hasta: "2026-03-01" }, TZ)).toBeNull();
    expect(parsePaidRange({ desde: "2025-01-01", hasta: "2026-03-10" }, TZ)).toBeNull();
    expect(parsePaidRange({ desde: "2025-03-10", hasta: "2026-03-10" }, TZ)).not.toBeNull();
  });
});
