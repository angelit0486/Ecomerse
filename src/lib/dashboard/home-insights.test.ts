import { describe, expect, it } from "vitest";

import {
  CARD_ERROR,
  cardOk,
  cartRecoverySettingsHref,
  compareValues,
  customersHref,
  describeComparison,
  formatAge,
  isStale,
  metricComparison,
  ordersHref,
  previousPeriod,
} from "./home-insights";

const count = (n: number) => n.toLocaleString("es-MX");
const money = (n: number) => `$${(n / 100).toFixed(2)}`;

describe("previousPeriod", () => {
  it("30 días: los 30 inmediatamente anteriores", () => {
    expect(previousPeriod({ from: "2026-10-18", to: "2026-11-16" })).toEqual({
      from: "2026-09-18",
      to: "2026-10-17",
    });
  });
  it("7 días cruzando mes y año", () => {
    expect(previousPeriod({ from: "2026-01-03", to: "2026-01-09" })).toEqual({
      from: "2025-12-27",
      to: "2026-01-02",
    });
  });
  it("90 días con febrero bisiesto", () => {
    const prev = previousPeriod({ from: "2028-03-01", to: "2028-05-29" });
    expect(prev).toEqual({ from: "2027-12-02", to: "2028-02-29" });
  });
  it("un solo día: el día anterior", () => {
    expect(previousPeriod({ from: "2026-03-10", to: "2026-03-10" })).toEqual({
      from: "2026-03-09",
      to: "2026-03-09",
    });
  });
  it("rango invertido: error", () => {
    expect(() => previousPeriod({ from: "2026-03-10", to: "2026-03-01" })).toThrow();
  });
});

describe("compareValues", () => {
  it("sube: diferencia y porcentaje", () => {
    expect(compareValues(15000, 10000)).toEqual({
      kind: "change",
      delta: 5000,
      percent: 50,
      direction: "up",
    });
  });
  it("baja con un decimal", () => {
    expect(compareValues(2, 3)).toEqual({
      kind: "change",
      delta: -1,
      percent: -33.3,
      direction: "down",
    });
  });
  it("igual", () => {
    expect(compareValues(7, 7)).toMatchObject({ kind: "change", delta: 0, direction: "flat" });
  });
  it("anterior en cero: sin porcentaje (nada de +∞ %)", () => {
    expect(compareValues(500, 0)).toEqual({ kind: "no_previous" });
  });
  it("ambos en cero", () => {
    expect(compareValues(0, 0)).toEqual({ kind: "both_zero" });
  });
  it("anterior negativo (más reembolsos que ventas): solo la diferencia", () => {
    expect(compareValues(1000, -500)).toEqual({
      kind: "change",
      delta: 1500,
      percent: null,
      direction: "up",
    });
  });
});

describe("describeComparison", () => {
  it("texto con signo, monto y porcentaje", () => {
    expect(describeComparison(compareValues(15000, 10000), money, "x")).toBe(
      "+$50.00 (+50 %) vs. periodo anterior",
    );
    expect(describeComparison(compareValues(2, 3), count, "x")).toBe(
      "−1 (−33.3 %) vs. periodo anterior",
    );
  });
  it("anterior en cero: el texto explicativo", () => {
    const text = describeComparison(
      compareValues(500, 0),
      money,
      "Sin ventas en el periodo anterior",
    );
    expect(text).toBe("Sin ventas en el periodo anterior");
    expect(text).not.toMatch(/∞|Infinity|NaN/);
  });
  it("ambos en cero e iguales", () => {
    expect(describeComparison(compareValues(0, 0), count, "x")).toBe(
      "Igual que el periodo anterior (en cero)",
    );
    expect(describeComparison(compareValues(4, 4), count, "x")).toBe(
      "Igual que el periodo anterior",
    );
  });
  it("anterior negativo: sin porcentaje", () => {
    expect(describeComparison(compareValues(1000, -500), money, "x")).toBe(
      "+$15.00 vs. periodo anterior",
    );
  });
  it("metricComparison da dirección para el color", () => {
    expect(metricComparison(1, 2, count, "x").direction).toBe("down");
    expect(metricComparison(1, 0, count, "Sin pedidos")).toEqual({
      text: "Sin pedidos",
      direction: "none",
    });
  });
});

describe("formatAge", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  it.each([
    ["2026-11-16T11:59:40Z", "hace menos de un minuto"],
    ["2026-11-16T11:59:00Z", "hace 1 minuto"],
    ["2026-11-16T11:15:00Z", "hace 45 minutos"],
    ["2026-11-16T11:00:00Z", "hace 1 hora"],
    ["2026-11-15T13:00:00Z", "hace 23 horas"],
    ["2026-11-14T13:00:00Z", "hace 47 horas"],
    ["2026-11-14T12:00:00Z", "hace 2 días"],
    ["2026-10-17T12:00:00Z", "hace 30 días"],
  ])("%s → %s", (since, expected) => {
    expect(formatAge(since, now)).toBe(expected);
  });
  it("fecha futura (reloj desfasado): no da edades negativas", () => {
    expect(formatAge("2026-11-16T12:05:00Z", now)).toBe("hace menos de un minuto");
  });
  it("fecha inválida: vacío", () => {
    expect(formatAge("no-es-fecha", now)).toBe("");
  });
  it("isStale: 24 h o más", () => {
    expect(isStale("2026-11-15T12:00:00Z", now)).toBe(true);
    expect(isStale("2026-11-15T12:00:01Z", now)).toBe(false);
  });
});

describe("enlaces filtrados", () => {
  const base = "/admin/mi-tienda";
  it("pedidos por estado (filtros que la lista ya soporta)", () => {
    expect(ordersHref(base, "por-surtir")).toBe("/admin/mi-tienda/pedidos?estado=por-surtir");
    expect(ordersHref(base, "pendientes")).toBe("/admin/mi-tienda/pedidos?estado=pendientes");
    expect(ordersHref(base, "atencion")).toBe("/admin/mi-tienda/pedidos?estado=atencion");
  });
  it("pedidos pagados en el rango del periodo", () => {
    expect(ordersHref(base, "todos", { from: "2026-10-18", to: "2026-11-16" })).toBe(
      "/admin/mi-tienda/pedidos?estado=todos&desde=2026-10-18&hasta=2026-11-16",
    );
  });
  it("clientes y ajuste de carritos", () => {
    expect(customersHref(base)).toBe("/admin/mi-tienda/clientes");
    expect(cartRecoverySettingsHref(base)).toBe("/admin/mi-tienda/ajustes/notificaciones");
  });
});

describe("estados de tarjeta", () => {
  it("ok lleva el dato; error no lleva ningún número", () => {
    expect(cardOk(0)).toEqual({ status: "ok", data: 0 });
    expect(CARD_ERROR).toEqual({ status: "error" });
    expect("data" in CARD_ERROR).toBe(false);
  });
});
