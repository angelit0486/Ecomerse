import { describe, expect, it } from "vitest";

import {
  quickChanges,
  soldOutKey,
  soldOutMessage,
  soldOutPlan,
  type SoldOutResult,
  type StockRow,
} from "./sold-out";

const row = (over: Partial<StockRow> = {}): StockRow => ({
  variant_id: "v1",
  track_inventory: true,
  inventory_policy: "deny",
  on_hand: 10,
  reserved: 0,
  ...over,
});

describe("marcar agotado", () => {
  it("deja el disponible en 0: en mano queda igual a lo apartado", () => {
    expect(soldOutPlan(row())).toEqual({ kind: "set", target: 0, keepsSelling: false });
    // Con 3 piezas apartadas para pedidos ya hechos, en mano queda en 3 (no en 0).
    expect(soldOutPlan(row({ on_hand: 10, reserved: 3 }))).toEqual({
      kind: "set",
      target: 3,
      keepsSelling: false,
    });
  });

  it("si ya estaba agotada o sin seguimiento, no se mueve nada", () => {
    expect(soldOutPlan(row({ on_hand: 3, reserved: 3 }))).toEqual({ kind: "already" });
    expect(soldOutPlan(row({ on_hand: 0 }))).toEqual({ kind: "already" });
    expect(soldOutPlan(row({ track_inventory: false }))).toEqual({ kind: "untracked" });
  });

  it("avisa cuando la variante se sigue vendiendo sin existencias", () => {
    expect(soldOutPlan(row({ inventory_policy: "continue" }))).toMatchObject({
      keepsSelling: true,
    });
  });

  it("la clave es por envío: repetir el mismo envío no mueve dos veces, agotar otra vez sí", () => {
    const n1 = "0b7e6a52-6f1e-4c3a-9d55-1f0c2a7b9e01";
    const n2 = "5c2d1f00-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
    expect(soldOutKey(row(), n1)).toBe(soldOutKey(row(), n1));
    // Agotar, reponer y volver a agotar con las mismas cifras: otra clave.
    expect(soldOutKey(row(), n1)).not.toBe(soldOutKey(row(), n2));
    const long = soldOutKey(row({ variant_id: n2 }), n1);
    expect(long.length).toBeGreaterThanOrEqual(8);
    expect(long.length).toBeLessThanOrEqual(100);
  });
});

describe("actualización rápida: solo las filas que cambiaron", () => {
  const form = (pairs: [string, string][]) => quickChanges(pairs);

  it("manda las que cambiaron y salta las iguales o vacías", () => {
    expect(
      form([
        ["stock:a", "12"],
        ["orig:a", "10"],
        ["stock:b", "5"],
        ["orig:b", "5"],
        ["stock:c", ""],
        ["orig:c", "7"],
        ["stock:d", "0"],
        ["orig:d", "4"],
      ]),
    ).toEqual({
      changes: [
        { variantId: "a", from: 10, to: 12 },
        { variantId: "d", from: 4, to: 0 },
      ],
      invalid: [],
    });
  });

  it("no deja menos de lo apartado para pedidos (el disponible quedaría en negativo)", () => {
    const r = form([
      ["stock:a", "2"],
      ["orig:a", "10"],
      ["res:a", "3"],
      ["stock:b", "3"],
      ["orig:b", "10"],
      ["res:b", "3"],
    ]);
    expect(r.invalid).toEqual(["a"]);
    expect(r.changes).toEqual([{ variantId: "b", from: 10, to: 3 }]);
  });

  it("marca como no válidos los negativos, decimales, texto o cantidades enormes", () => {
    const r = form([
      ["stock:a", "-1"],
      ["orig:a", "1"],
      ["stock:b", "2.5"],
      ["orig:b", "1"],
      ["stock:c", "diez"],
      ["orig:c", "1"],
      ["stock:d", "1000001"],
      ["orig:d", "1"],
    ]);
    expect(r.changes).toEqual([]);
    expect(r.invalid).toEqual(["a", "b", "c", "d"]);
  });
});

describe("mensaje de «Marcar agotado»", () => {
  const r = (over: Partial<SoldOutResult> = {}): SoldOutResult => ({
    marked: 0,
    already: 0,
    untracked: 0,
    keepsSelling: 0,
    failed: 0,
    ...over,
  });

  it("dice cuántas se marcaron y cuáles ya estaban", () => {
    expect(soldOutMessage(r({ marked: 1 }))).toEqual({
      ok: true,
      message: "1 variante marcada como agotada.",
    });
    expect(soldOutMessage(r({ marked: 3, already: 2 })).message).toBe(
      "3 variantes marcadas como agotadas. 2 ya estaban agotadas.",
    );
    expect(soldOutMessage(r({ already: 1 }))).toEqual({
      ok: true,
      message: "1 ya estaba agotada.",
    });
  });

  it("no dice «listo» si nada se pudo marcar", () => {
    expect(soldOutMessage(r({ failed: 2 })).ok).toBe(false);
    expect(soldOutMessage(r({ untracked: 1 })).ok).toBe(false);
    expect(soldOutMessage(r({ untracked: 1 })).message).toContain("sin seguimiento de inventario");
    expect(soldOutMessage(r())).toEqual({ ok: false, message: "No había nada que marcar." });
  });

  it("avisa de las que se siguen vendiendo sin existencias", () => {
    expect(soldOutMessage(r({ marked: 1, keepsSelling: 1 })).message).toContain(
      "Atención: 1 se sigue vendiendo sin existencias",
    );
  });
});
