import { readFileSync } from "node:fs";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

// @ts-expect-error — módulo .mjs sin tipos (script de documentación).
import { casesPath, docPath, render } from "../../scripts/docs/golden-cart-cases.mjs";

/** Casos dorados de app.cart_totals (GATE0 §17.3), revisables en docs/phases/golden-cart-cases.md. */
interface GoldenCase {
  id: string;
  lines: { unit_price: number; quantity: number }[];
  rules: Record<string, unknown>;
  expected: {
    subtotal: number;
    discount_total: number;
    shipping_total: number;
    tax_total: number;
    total: number;
    allocations: number[];
  };
}

const data = JSON.parse(readFileSync(casesPath, "utf8")) as { cases: GoldenCase[] };
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

describe("casos dorados del carrito", () => {
  it.each(data.cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const [row] = await admin<
      { r: Record<string, unknown> & { lines: { discount_allocation: number }[] } }[]
    >`
      select app.cart_totals(${admin.json(c.lines)}, ${admin.json(c.rules as never)}) as r`;
    const r = row!.r;
    expect({
      subtotal: r.subtotal,
      discount_total: r.discount_total,
      shipping_total: r.shipping_total,
      tax_total: r.tax_total,
      total: r.total,
      allocations: r.lines.map((l) => l.discount_allocation),
    }).toEqual(c.expected);
    // Suma exacta del reparto.
    expect(c.expected.allocations.reduce((a, b) => a + b, 0)).toBe(c.expected.discount_total);
  });

  it("el documento para el propietario está al día", () => {
    expect(readFileSync(docPath, "utf8")).toBe(render(data));
  });
});
