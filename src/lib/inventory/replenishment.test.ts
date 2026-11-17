import { describe, expect, it } from "vitest";

import {
  buildReplenishment,
  coverageDays,
  DEFAULT_TARGET_DAYS,
  MAX_TARGET_DAYS,
  pickSupplier,
  SAFETY_DAYS,
  type SaleLine,
  salesWindow,
  type StockItem,
  suggestedQuantity,
  type SupplierOption,
  targetDaysFor,
  unitsByVariant,
  WINDOW_DAYS,
} from "./replenishment";

const item = (over: Partial<StockItem> = {}): StockItem => ({
  variantId: "v1",
  productId: "p1",
  productTitle: "Café molido",
  optionSignature: "",
  sku: "CAF-1",
  trackInventory: true,
  available: 10,
  lowStockThreshold: null,
  ...over,
});

const supplier = (over: Partial<SupplierOption> = {}): SupplierOption => ({
  id: "s1",
  name: "Proveedor A",
  status: "active",
  leadTimeMinDays: null,
  leadTimeMaxDays: null,
  ...over,
});

const sales = (entries: Record<string, number>) => new Map(Object.entries(entries));

const window = {
  start: new Date("2026-10-18T06:00:00Z"),
  end: new Date("2026-11-17T06:00:00Z"),
};
const line = (over: Partial<SaleLine> = {}): SaleLine => ({
  variantId: "v1",
  quantity: 2,
  refundedQuantity: 0,
  orderStatus: "open",
  paymentStatus: "paid",
  paidAt: "2026-11-10T18:00:00Z",
  ...over,
});

describe("constantes", () => {
  it("son las del contrato de la orden", () => {
    expect(WINDOW_DAYS).toBe(30);
    expect(SAFETY_DAYS).toBe(7);
    expect(DEFAULT_TARGET_DAYS).toBe(30);
    expect(MAX_TARGET_DAYS).toBe(90);
  });
});

describe("salesWindow", () => {
  it("30 días de calendario hasta hoy en la zona de la tienda (instantes de zonedDayStart)", () => {
    // 16 nov 20:30 en Hermosillo (UTC−7); en UTC ya es 17 nov.
    const w = salesWindow("America/Hermosillo", new Date("2026-11-17T03:30:00Z"));
    expect(w.from).toBe("2026-10-18");
    expect(w.to).toBe("2026-11-16");
    expect(w.start.toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-17T07:00:00.000Z");
  });

  it("en UTC el mismo instante ya cuenta el día 17", () => {
    const w = salesWindow("UTC", new Date("2026-11-17T03:30:00Z"));
    expect(w.from).toBe("2026-10-19");
    expect(w.to).toBe("2026-11-17");
    expect(w.start.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });

  it("CDMX: 00:00 = 06:00Z, igual que dashboard_kpis", () => {
    const w = salesWindow("America/Mexico_City", new Date("2026-11-16T12:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-10-18T06:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-17T06:00:00.000Z");
  });
});

describe("unitsByVariant", () => {
  it("suma cantidades de pedidos pagados en la ventana", () => {
    const u = unitsByVariant([line(), line({ quantity: 3 }), line({ variantId: "v2" })], window);
    expect(u.get("v1")).toBe(5);
    expect(u.get("v2")).toBe(2);
  });

  it("excluye pedidos cancelados", () => {
    const u = unitsByVariant([line(), line({ orderStatus: "cancelled", quantity: 9 })], window);
    expect(u.get("v1")).toBe(2);
  });

  it("resta refunded_quantity e ignora líneas totalmente reembolsadas", () => {
    const u = unitsByVariant(
      [line({ quantity: 5, refundedQuantity: 2 }), line({ quantity: 1, refundedQuantity: 1 })],
      window,
    );
    expect(u.get("v1")).toBe(3);
  });

  it("partially_refunded cuenta lo no reembolsado", () => {
    const u = unitsByVariant(
      [line({ paymentStatus: "partially_refunded", quantity: 4, refundedQuantity: 1 })],
      window,
    );
    expect(u.get("v1")).toBe(3);
  });

  it("no cuenta pagos no cobrados ni reembolsados por completo", () => {
    const u = unitsByVariant(
      ["pending", "authorized", "unpaid", "refunded", "failed", "voided"].map((p) =>
        line({ paymentStatus: p }),
      ),
      window,
    );
    expect(u.size).toBe(0);
  });

  it("ignora líneas sin variante, sin paid_at o con unidades ≤ 0", () => {
    const u = unitsByVariant(
      [line({ variantId: null }), line({ paidAt: null }), line({ quantity: 0 })],
      window,
    );
    expect(u.size).toBe(0);
  });

  it("límites de la ventana: inicio inclusivo, fin exclusivo", () => {
    const u = unitsByVariant(
      [
        line({ paidAt: "2026-10-18T06:00:00Z", quantity: 1 }),
        line({ paidAt: "2026-10-18T05:59:59Z", quantity: 10 }),
        line({ paidAt: "2026-11-17T05:59:59Z", quantity: 100 }),
        line({ paidAt: "2026-11-17T06:00:00Z", quantity: 1000 }),
      ],
      window,
    );
    expect(u.get("v1")).toBe(101);
  });
});

describe("pickSupplier y targetDaysFor", () => {
  it("sin proveedores no hay referencia; el horizonte es 30", () => {
    expect(pickSupplier([])).toBeNull();
    expect(targetDaysFor(null)).toBe(30);
  });

  it("usa el máximo del plazo, o el mínimo si solo hay mínimo", () => {
    const range = supplier({ leadTimeMinDays: 3, leadTimeMaxDays: 10 });
    expect(pickSupplier([range])?.leadDays).toBe(10);
    expect(pickSupplier([supplier({ leadTimeMinDays: 4 })])?.leadDays).toBe(4);
  });

  it("ignora proveedores inactivos", () => {
    expect(pickSupplier([supplier({ status: "inactive", leadTimeMaxDays: 2 })])).toBeNull();
  });

  it("varios activos: el de menor plazo; empate por nombre y luego id", () => {
    const opts = [
      supplier({ id: "s3", name: "Zeta", leadTimeMaxDays: 5 }),
      supplier({ id: "s2", name: "Beta", leadTimeMaxDays: 5 }),
      supplier({ id: "s1", name: "Alfa", leadTimeMaxDays: 12 }),
      supplier({ id: "s0", name: "Sin plazo" }),
      supplier({ id: "s9", name: "Inactivo", status: "inactive", leadTimeMaxDays: 1 }),
    ];
    expect(pickSupplier(opts)).toEqual({ id: "s2", name: "Beta", leadDays: 5 });
    expect(pickSupplier([...opts].reverse())).toEqual({ id: "s2", name: "Beta", leadDays: 5 });
    expect(
      pickSupplier([
        supplier({ id: "b", name: "Igual", leadTimeMaxDays: 5 }),
        supplier({ id: "a", name: "Igual", leadTimeMaxDays: 5 }),
      ])?.id,
    ).toBe("a");
  });

  it("activo sin plazo: se muestra, pero el horizonte es el predeterminado", () => {
    const s = pickSupplier([supplier()]);
    expect(s).toEqual({ id: "s1", name: "Proveedor A", leadDays: null });
    expect(targetDaysFor(s!.leadDays)).toBe(30);
  });

  it("el plazo alarga el horizonte (plazo + 7) con tope de 90", () => {
    expect(targetDaysFor(0)).toBe(7);
    expect(targetDaysFor(40)).toBe(47);
    expect(targetDaysFor(83)).toBe(90);
    expect(targetDaysFor(200)).toBe(90);
  });
});

describe("coverageDays y suggestedQuantity", () => {
  it("sin ritmo no hay cobertura ni sugerencia (nada de Infinity ni 0 inventado)", () => {
    expect(coverageDays(10, 0)).toBeNull();
    expect(suggestedQuantity(10, 0, 30)).toBeNull();
    expect(coverageDays(0, 0)).toBeNull();
  });

  it("cobertura = floor(disponible / ritmo)", () => {
    // 45 vendidas en 30 días = 1.5 al día; 10 / 1.5 = 6.67 → 6
    expect(coverageDays(10, 45)).toBe(6);
    expect(coverageDays(30, 30)).toBe(30);
    expect(coverageDays(-3, 30)).toBe(0);
  });

  it("sugerencia = ceil(ritmo × horizonte − disponible), sin errores de punto flotante", () => {
    // 3/30 × 37 = 3.7 → 4 (en flotante 3.7000000000000006; en enteros es exacto)
    expect(suggestedQuantity(0, 3, 37)).toBe(4);
    // 30/30 × 30 − 10 = 20 exacto: no debe subir a 21
    expect(suggestedQuantity(10, 30, 30)).toBe(20);
    // 7/30 × 30 = 7 exacto
    expect(suggestedQuantity(0, 7, 30)).toBe(7);
    // 1 vendida, 5 disponibles: 1/30 × 30 − 5 < 0 → 0, nunca negativo
    expect(suggestedQuantity(5, 1, 30)).toBe(0);
  });
});

describe("buildReplenishment", () => {
  it("en el aviso sin ventas: entra con sugerencia null", () => {
    const [row] = buildReplenishment({
      stock: [item({ available: 3, lowStockThreshold: 5 })],
      sales: sales({}),
    });
    expect(row).toMatchObject({
      lowStock: true,
      unitsSold: 0,
      coverageDays: null,
      suggestedQuantity: null,
      targetDays: 30,
    });
  });

  it("sobre el aviso y sin ventas: no entra", () => {
    expect(
      buildReplenishment({
        stock: [item({ available: 20, lowStockThreshold: 5 })],
        sales: sales({}),
      }),
    ).toEqual([]);
  });

  it("sin aviso, disponible ≤ 0 cuenta como stock bajo", () => {
    const rows = buildReplenishment({
      stock: [item({ available: 0 }), item({ variantId: "v2", available: 1 })],
      sales: sales({}),
    });
    expect(rows.map((r) => r.variantId)).toEqual(["v1"]);
  });

  /** Una sola variante (v1) con `units` vendidas y, opcionalmente, proveedores. */
  const one = (available: number, units: number, suppliers: SupplierOption[] = []) =>
    buildReplenishment({
      stock: [item({ available })],
      sales: sales({ v1: units }),
      suppliersByVariant: new Map([["v1", suppliers]]),
    });

  it("el ritmo la agota dentro del horizonte: entra con cantidad hacia arriba", () => {
    // 20 vendidas → 0.667/día; 15 disponibles → 22 días ≤ 30; pedir ceil(20 − 15) = 5
    expect(one(15, 20)[0]).toMatchObject({
      coverageDays: 22,
      suggestedQuantity: 5,
      lowStock: false,
    });
  });

  it("redondeo hacia arriba de fracciones", () => {
    // 7 vendidas, 1 disponible, 30 días → 7 − 1 = 6; con 37 días → 8.63 − 1 = 7.63 → 8
    expect(one(1, 7)[0]!.suggestedQuantity).toBe(6);
    const withLead = one(1, 7, [supplier({ leadTimeMaxDays: 30 })]);
    expect(withLead[0]!.targetDays).toBe(37);
    expect(withLead[0]!.suggestedQuantity).toBe(8);
  });

  it("stock suficiente para el horizonte: no entra", () => {
    // 30 vendidas → 1/día; 31 disponibles → 31 días > 30
    expect(one(31, 30)).toEqual([]);
    // justo en el límite sí entra (cobertura ≤ horizonte) y sugiere 0
    expect(one(30, 30)[0]).toMatchObject({ coverageDays: 30, suggestedQuantity: 0 });
  });

  it("disponible 0 con ventas: cobertura 0 y pide el horizonte completo", () => {
    expect(one(0, 9)[0]).toMatchObject({ coverageDays: 0, suggestedQuantity: 9, lowStock: true });
  });

  it("disponible negativo (se vende sin existencias): pide también lo que se debe", () => {
    expect(one(-2, 30)[0]).toMatchObject({ coverageDays: 0, suggestedQuantity: 32 });
  });

  it("track_inventory false nunca entra", () => {
    expect(
      buildReplenishment({
        stock: [item({ trackInventory: false, available: 0, lowStockThreshold: 5 })],
        sales: sales({ v1: 100 }),
      }),
    ).toEqual([]);
  });

  it("el plazo del proveedor alarga el horizonte y puede meter a la lista", () => {
    // 30 vendidas, 35 disponibles: con 30 días no entra; con plazo 30 → 37 días sí
    expect(one(35, 30)).toEqual([]);
    const [row] = one(35, 30, [supplier({ leadTimeMinDays: 5, leadTimeMaxDays: 30 })]);
    expect(row).toMatchObject({
      targetDays: 37,
      coverageDays: 35,
      suggestedQuantity: 2,
      supplier: { name: "Proveedor A", leadDays: 30 },
    });
  });

  it("tope de 90 días aunque el plazo sea mayor", () => {
    const [row] = one(0, 30, [supplier({ leadTimeMaxDays: 120 })]);
    expect(row).toMatchObject({ targetDays: 90, suggestedQuantity: 90 });
  });

  it("sin datos de pedidos (sales null): solo regla de stock bajo y nada estimado", () => {
    const rows = buildReplenishment({
      stock: [
        item({ variantId: "bajo", available: 2, lowStockThreshold: 5 }),
        item({ variantId: "ok", available: 3, lowStockThreshold: 2 }),
      ],
      sales: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId: "bajo",
      unitsSold: null,
      coverageDays: null,
      suggestedQuantity: null,
    });
  });

  it("orden: agotadas (más vendidas antes), menor cobertura, stock bajo sin ritmo", () => {
    const rows = buildReplenishment({
      stock: [
        item({ variantId: "sin-ritmo", productTitle: "A", available: 1, lowStockThreshold: 3 }),
        item({ variantId: "cob-20", productTitle: "B", available: 20 }),
        item({ variantId: "cob-5", productTitle: "C", available: 5 }),
        item({ variantId: "agotada-poca", productTitle: "D", available: 0 }),
        item({ variantId: "agotada-mucha", productTitle: "E", available: 0 }),
      ],
      sales: sales({ "cob-20": 30, "cob-5": 30, "agotada-poca": 1, "agotada-mucha": 50 }),
    });
    expect(rows.map((r) => r.variantId)).toEqual([
      "agotada-mucha",
      "agotada-poca",
      "cob-5",
      "cob-20",
      "sin-ritmo",
    ]);
  });

  it("desempate estable por título, SKU e id", () => {
    const rows = buildReplenishment({
      stock: [
        item({ variantId: "c", productTitle: "Té", sku: "B", available: 0 }),
        item({ variantId: "b", productTitle: "Té", sku: "A", available: 0 }),
        item({ variantId: "a", productTitle: "Té", sku: "A", available: 0 }),
        item({ variantId: "z", productTitle: "Agua", sku: "Z", available: 0 }),
      ],
      sales: sales({}),
    });
    expect(rows.map((r) => r.variantId)).toEqual(["z", "a", "b", "c"]);
  });
});
