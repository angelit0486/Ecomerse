import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { METRIC_WINDOWS, metricsSchema } from "@/lib/platform/metrics";

/**
 * Consola → Métricas (misión vendible F4): lo que devuelve la base cumple el
 * esquema que usa la pantalla, en cada ventana. Corre en una transacción que se
 * revierte, como platform_admin.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
const run = Math.random().toString(36).slice(2, 8);

class Rollback extends Error {}

afterAll(() => admin.end());

describe("platform_metrics", () => {
  it("cumple el esquema de la pantalla en 7, 30, 90 y 365 días", async () => {
    await admin
      .begin(async (tx) => {
        const [u] = await tx<{ id: string }[]>`
          insert into auth.users (id, email) values (gen_random_uuid(), ${`metricas-${run}@plataforma.test`})
          returning id`;
        await tx`insert into public.platform_staff (user_id, role) values (${u!.id}, 'platform_admin')`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({
          sub: u!.id,
          role: "authenticated",
          aal: "aal2",
        })}, true), set_config('role', 'authenticated', true)`;
        for (const days of METRIC_WINDOWS) {
          const [row] = await tx<{ m: unknown }[]>`select public.platform_metrics(${days}) as m`;
          const parsed = metricsSchema.parse(row!.m);
          expect(parsed.days).toBe(days);
        }
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
