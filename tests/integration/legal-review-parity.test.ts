import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { needsLegalReview } from "@/lib/content/legal-review";

/**
 * Paridad entre la marca «Pendiente de revisión legal» del panel y la condición
 * de la validación de lanzamiento (`20261014000400_store_launch.sql`).
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(() => admin.end());

const CASES = [
  "",
  "   ",
  "<p><strong>Plantilla en borrador.</strong> Completa…</p><h2>Plazo</h2><p>[Plazo]</p>",
  "<h2>Plazo</h2><p> [Plazo para solicitar un cambio] </p>",
  "<h2>Plazo</h2><p>Tienes 30 días [naturales] para pedir un cambio.</p>",
  "<h2>Plazo</h2><p>Tienes 30 días para pedir un cambio.</p>",
  "<p>[<em>x</em>]</p>",
];

describe("paridad de la revisión legal con el lanzamiento", () => {
  it.each(CASES.map((c) => [JSON.stringify(c), c] as const))("%s", async (_, body) => {
    const [row] = await admin<{ ok: boolean }[]>`
      select (btrim(${body}) <> ''
              and position('Plantilla en borrador' in ${body}) = 0
              and ${body} !~ '<p>\\s*\\[[^]<]*\\]\\s*</p>') as ok`;
    expect(needsLegalReview(body)).toBe(!row!.ok);
  });
});
