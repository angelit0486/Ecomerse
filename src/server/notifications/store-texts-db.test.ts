import { describe, expect, it } from "vitest";

import type { Sql } from "@/server/db/role-clients";
import { createLogger } from "@/server/observability/logger";

import { fetchStoreText } from "./store-texts-db";

describe("textos de la tienda desde la base (revisión 2026-11-05)", () => {
  it("si la lectura falla (p. ej. falta la migración), el correo sale con el texto de siempre", async () => {
    const lines: string[] = [];
    const db = (() => Promise.reject(new Error("function does not exist"))) as unknown as Sql;
    const log = createLogger({ sink: (l) => lines.push(l) });
    await expect(fetchStoreText(db, "s1", "order_shipped", log)).resolves.toBeNull();
    expect(lines.join("\n")).toContain("notification.store_text_failed");
  });

  it("devuelve el texto del correo pedido o null", async () => {
    const db = (() =>
      Promise.resolve([
        { value: { order_shipped: { subject: "Hola", note: null } } },
      ])) as unknown as Sql;
    const log = createLogger({ sink: () => {} });
    expect(await fetchStoreText(db, "s1", "order_shipped", log)).toEqual({
      subject: "Hola",
      note: null,
    });
    expect(await fetchStoreText(db, "s1", "refund_issued", log)).toBeNull();
  });
});
