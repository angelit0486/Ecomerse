import { describe, expect, it } from "vitest";

import {
  EMPTY_PROMOTION,
  parsePromotionForm,
  percentToBps,
  promotionExample,
  promotionToFormValues,
  promotionValuesFromFormData,
  type PromotionFormValues,
} from "./form";
import { promotionRules } from "./rules";

const base = (o: Partial<PromotionFormValues>): PromotionFormValues => ({
  ...EMPTY_PROMOTION,
  name: "Playeras 3x2",
  label: "3×2 en playeras",
  ...o,
});

describe("formulario de promociones", () => {
  it("3×2 en toda la tienda", () => {
    const r = parsePromotionForm(base({}));
    expect(r).toEqual({
      ok: true,
      payload: {
        name: "Playeras 3x2",
        label: "3×2 en playeras",
        type: "buy_n_pay_m",
        rules: { buy: 3, pay: 2 },
        scope: "store",
        applies_to_sale_items: false,
        starts_on: null,
        ends_on: null,
      },
    });
  });

  it("pagar lo mismo que se lleva no es promoción", () => {
    const r = parsePromotionForm(base({ buy: "3", pay: "3" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual(["pay"]);
  });

  it("la segunda al 50 % con porcentaje con decimales", () => {
    const r = parsePromotionForm(base({ type: "nth_percent", nth: "2", nth_percent: "12,5" }));
    expect(r.ok && r.payload.rules).toEqual({ nth: 2, percent_bps: 1250 });
  });

  it("mayoreo por precio: escalones vacíos se ignoran, el precio baja", () => {
    const r = parsePromotionForm(
      base({
        type: "volume",
        volume_mode: "unit_price",
        tiers: [
          { qty: "5", value: "90" },
          { qty: "", value: "" },
          { qty: "10", value: "80.50" },
        ],
      }),
    );
    expect(r.ok && r.payload.rules).toEqual({
      mode: "unit_price",
      tiers: [
        { min_qty: 5, value: 9000 },
        { min_qty: 10, value: 8050 },
      ],
    });
  });

  it("mayoreo: un escalón más caro o con menos piezas se rechaza", () => {
    for (const tiers of [
      [
        { qty: "5", value: "90" },
        { qty: "10", value: "95" },
      ],
      [
        { qty: "10", value: "90" },
        { qty: "5", value: "80" },
      ],
      [{ qty: "1", value: "90" }],
      [],
    ]) {
      const r = parsePromotionForm(base({ type: "volume", tiers }));
      expect(r.ok ? null : Object.keys(r.fields)).toEqual(["tiers"]);
    }
  });

  it("mayoreo en porcentaje no llega a 100 %", () => {
    const r = parsePromotionForm(
      base({ type: "volume", volume_mode: "percent", tiers: [{ qty: "3", value: "100" }] }),
    );
    expect(r.ok).toBe(false);
  });

  it("productos o categorías: al menos uno, sin repetidos", () => {
    expect(parsePromotionForm(base({ scope: "products" }))).toMatchObject({
      ok: false,
      fields: { targets: expect.any(String) },
    });
    const r = parsePromotionForm(base({ scope: "categories", category_ids: ["a", "a", "b"] }));
    expect(r.ok && r.payload.category_ids).toEqual(["a", "b"]);
    expect(r.ok && "product_ids" in r.payload).toBe(false);
  });

  it("nombre, leyenda y fechas", () => {
    const r = parsePromotionForm(
      base({ name: " ", label: "x".repeat(41), starts_at: "2026-12-10", ends_at: "2026-12-01" }),
    );
    expect(r.ok ? [] : Object.keys(r.fields).sort()).toEqual(["dates", "label", "name"]);
  });

  it("FormData → valores → payload, y de regreso para editar", () => {
    const fd = new FormData();
    fd.set("id", "11111111-1111-4111-8111-111111111111");
    fd.set("name", "Mayoreo gorras");
    fd.set("label", "Mayoreo");
    fd.set("type", "volume");
    fd.set("volume_mode", "percent");
    fd.set("tier_qty_0", "6");
    fd.set("tier_value_0", "10");
    fd.set("tier_qty_1", "12");
    fd.set("tier_value_1", "15");
    fd.set("scope", "products");
    fd.append("product_ids", "p1");
    fd.append("product_ids", "p2");
    fd.set("applies_to_sale_items", "on");
    fd.set("starts_at", "2026-12-01");
    const v = promotionValuesFromFormData(fd);
    const r = parsePromotionForm(v);
    expect(r.ok && r.payload).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      rules: {
        mode: "percent",
        tiers: [
          { min_qty: 6, value: 1000 },
          { min_qty: 12, value: 1500 },
        ],
      },
      product_ids: ["p1", "p2"],
      applies_to_sale_items: true,
      starts_on: "2026-12-01",
      ends_on: null,
    });
    const back = promotionToFormValues({
      id: "x",
      name: "n",
      label: "l",
      type: "volume",
      rules: { mode: "unit_price", tiers: [{ min_qty: 5, value: 8550 }] },
      scope: "store",
      applies_to_sale_items: false,
      product_ids: [],
      category_ids: [],
      starts_at: "",
      ends_at: "",
    });
    expect(back.tiers).toEqual([{ qty: "5", value: "85.50" }]);
    expect(back.volume_mode).toBe("unit_price");
  });

  it("porcentajes", () => {
    expect(percentToBps("50")).toBe(5000);
    expect(percentToBps("0.01")).toBe(1);
    expect(percentToBps("0")).toBeNull();
    expect(percentToBps("100")).toBe(10000);
    expect(percentToBps("100", 9999)).toBeNull();
    expect(percentToBps("1.234")).toBeNull();
  });
});

describe("ejemplo para la dueña (misma aritmética que el motor)", () => {
  const ex = (x: unknown) => promotionExample(promotionRules.parse(x));
  it("3×2", () => {
    expect(ex({ type: "buy_n_pay_m", rules: { buy: 3, pay: 2 } })).toMatchObject({
      qty: 3,
      pay: 20000,
      save: 10000,
    });
  });
  it("la segunda al 50 %", () => {
    expect(ex({ type: "nth_percent", rules: { nth: 2, percent_bps: 5000 } }).save).toBe(5000);
  });
  it("mayoreo por precio: precio de ejemplo mayor al del escalón", () => {
    const e = ex({
      type: "volume",
      rules: { mode: "unit_price", tiers: [{ min_qty: 5, value: 8000 }] },
    });
    expect(e.price).toBe(10000);
    expect(e.save).toBe(10000);
    expect(e.text).toContain("si lleva 5");
  });
  it("mayoreo en porcentaje, mitad al par", () => {
    expect(
      ex({ type: "volume", rules: { mode: "percent", tiers: [{ min_qty: 3, value: 1250 }] } }).save,
    ).toBe(3750);
  });
});
