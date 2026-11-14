import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * H4-B (Orden 10, mensaje 7): scripts/ops/ventana/04-aislamiento.sql comprueba,
 * como el dueño de cada una de dos tiendas de prueba en organizaciones distintas,
 * que ve sus lotes, importaciones, publicaciones y revisiones de fotos, que no ve
 * nada de la otra y que no puede actuar sobre ella. Termina en ROLLBACK.
 *
 * Se corre con psql, igual que en la ventana. También se comprueba que el guion
 * DETECTA una fuga: con una política `using (true)` agregada dentro de su propia
 * transacción (y revertida con ella), la fila correspondiente sale en falso.
 */
const url = process.env.TEST_ADMIN_DATABASE_URL!;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const SCRIPT = readFileSync(join(process.cwd(), "scripts/ops/ventana/04-aislamiento.sql"), "utf8");

type Row = {
  comprobacion: string;
  valor: string;
  esperado: string;
  ok: boolean;
  categoria: string;
};

function runScript(sql: string): Row[] {
  const out = execFileSync(
    "psql",
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", "-d", url, "-f", "-"],
    {
      input: sql,
      encoding: "utf8",
    },
  );
  return out
    .trim()
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => {
      const [comprobacion, valor, esperado, ok, categoria] = line.split("|");
      return {
        comprobacion: comprobacion!,
        valor: valor!,
        esperado: esperado!,
        ok: ok === "t",
        categoria: categoria!,
      };
    });
}

async function counts() {
  const [row] = await admin<{ batches: number; runs: number; products: number }[]>`
    select (select count(*)::int from public.import_batches b join public.stores s on s.id = b.store_id
             where s.handle like 'pruva-ventana-%') as batches,
           (select count(*)::int from public.publish_runs r join public.stores s on s.id = r.store_id
             where s.handle like 'pruva-ventana-%') as runs,
           (select count(*)::int from public.products p join public.stores s on s.id = p.store_id
             where s.handle like 'pruva-ventana-%') as products`;
  return row!;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('ventana_qa', 'ventana_qa')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 100)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  for (const tag of ["a", "b"]) {
    const [o] = await admin<{ id: string }[]>`
      insert into public.organizations (name, slug, country)
      values (${`Ventana QA ${tag}`}, ${`org-pruva-ventana-${tag}`}, 'MX') returning id`;
    await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${o!.id}, ${plan!.id}, 'active')`;
    await admin`insert into public.stores (organization_id, name, handle, currency, country, timezone)
                values (${o!.id}, ${`Ventana QA ${tag}`}, ${`pruva-ventana-${tag}`}, 'MXN', 'MX', 'America/Mexico_City')`;
    const [u] = await admin<{ id: string }[]>`
      insert into auth.users (id, email) values (gen_random_uuid(), ${`qa-${tag}@ventana.test`}) returning id`;
    await admin`insert into public.organization_members (organization_id, user_id, role)
                values (${o!.id}, ${u!.id}, 'org_owner')`;
  }
});
afterAll(async () => {
  await admin.end();
});

describe("H4-B: aislamiento entre las tiendas de prueba de la ventana", () => {
  it("todas las comprobaciones en verde, en los dos sentidos, y no deja nada", async () => {
    const before = await counts();
    const rows = runScript(SCRIPT);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    // 6 tablas × (lo suyo + lo ajeno) + 5 acciones, por cada dueño; más 2 de anon.
    expect(rows).toHaveLength(2 * (6 * 2 + 5) + 2);
    expect(rows.every((r) => r.categoria === "detener")).toBe(true);
    for (const tag of ["A", "B"]) {
      expect(rows.map((r) => r.comprobacion)).toContain(
        `dueño ${tag} no ve import_batches de la otra tienda`,
      );
      expect(rows.map((r) => r.comprobacion)).toContain(
        `dueño ${tag} no cancela el lote de la otra`,
      );
    }
    expect(await counts()).toEqual(before);
  });

  it("detecta una fuga: una política que deja ver todos los lotes sale en falso", () => {
    const leaky = SCRIPT.replace(
      /^begin;$/m,
      "begin;\ncreate policy ventana_fuga on public.import_batches for select to authenticated using (true);",
    );
    expect(leaky).not.toBe(SCRIPT);
    const failing = runScript(leaky).filter((r) => !r.ok);
    expect(failing.map((r) => r.comprobacion).sort()).toEqual([
      "dueño A no ve import_batches de la otra tienda",
      "dueño B no ve import_batches de la otra tienda",
    ]);
  });

  it("se detiene si faltan las tiendas de prueba (no pasa en vacío)", () => {
    const missing = SCRIPT.replaceAll("pruva-ventana-b", "pruva-ventana-no-existe");
    expect(() => runScript(missing)).toThrow(/ventana_sin_tiendas_de_prueba/);
  });
});
