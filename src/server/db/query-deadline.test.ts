import type { Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { causedByDeadline, DbDeadlineError, withQueryDeadline } from "./query-deadline";
import { toAppError } from "./errors";

/**
 * F-08: pool falso con la forma de postgres.js. Cada plantilla devuelve una
 * «consulta» (thenable con métodos propios) que se resuelve, falla o nunca
 * responde, según lo que pida la prueba.
 */
type Mode = "ok" | "fail" | "hang";

function fakePool(name: string, mode: () => Mode) {
  const calls: string[] = [];
  const end = vi.fn(async () => {});
  const json = vi.fn((value: unknown) => ({ json: value, pool: name }));
  const sql = ((strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (!Array.isArray(strings)) return { fragment: strings, pool: name };
    const text = (strings as TemplateStringsArray).join("?");
    calls.push(text);
    const m = mode();
    const promise =
      m === "ok"
        ? Promise.resolve([{ pool: name, text, values }])
        : m === "fail"
          ? Promise.reject(Object.assign(new Error("boom"), { code: "P0001", message: "boom" }))
          : new Promise(() => {});
    // Como Query de postgres.js: un objeto propio con then/catch/finally y extras.
    const query = {
      then: (a?: (v: unknown) => unknown, b?: (e: unknown) => unknown) => promise.then(a, b),
      catch: (b?: (e: unknown) => unknown) => promise.catch(b),
      finally: (f?: () => void) => promise.finally(f),
      cancel: vi.fn(),
      values: () => query,
    };
    return query;
  }) as unknown as Sql & { calls: string[] };
  Object.assign(sql, {
    calls,
    end,
    json,
    begin: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      mode() === "hang" ? new Promise(() => {}) : fn({ pool: name }),
    ),
  });
  return sql as unknown as Sql & {
    calls: string[];
    end: typeof end;
    json: typeof json;
    begin: ReturnType<typeof vi.fn>;
  };
}

describe("withQueryDeadline (F-08)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(initial: Mode = "ok") {
    let mode: Mode = initial;
    const pools: ReturnType<typeof fakePool>[] = [];
    const onDeadline = vi.fn();
    const db = withQueryDeadline(
      () => {
        const pool = fakePool(`p${pools.length + 1}`, () => mode);
        pools.push(pool);
        return pool;
      },
      { ms: 15_000, onDeadline },
    );
    return { db, pools, onDeadline, setMode: (m: Mode) => (mode = m) };
  }

  it("una consulta que responde se comporta igual que sin plazo", async () => {
    const { db, pools, onDeadline } = setup();
    const rows = await db`select ${1}`;
    expect(rows).toEqual([{ pool: "p1", text: "select ?", values: [1] }]);
    expect(pools).toHaveLength(1);
    expect(onDeadline).not.toHaveBeenCalled();
    // Sin temporizadores colgando después de responder.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("un error de la base llega igual (no se confunde con un plazo)", async () => {
    const { db, pools } = setup("fail");
    const error = await db`select 1`.then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as Error).message).toBe("boom");
    expect(causedByDeadline(error)).toBe(false);
    expect(pools).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("una respuesta que nunca llega se rechaza a los 15 s, no a los 300 s", async () => {
    const { db, onDeadline } = setup("hang");
    const settled = db`select storefront.place_order()`.then(
      () => "resolved",
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(14_999);
    expect(onDeadline).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toBeInstanceOf(DbDeadlineError);
    expect(causedByDeadline(error)).toBe(true);
    expect(onDeadline).toHaveBeenCalledWith({ ms: 15_000, retired: true });
  });

  it("el pool atorado se cierra con gracia y el siguiente intento usa uno nuevo", async () => {
    const { db, pools, setMode } = setup("hang");
    const held = db; // como `const db = gatewayDb()` dentro de una función
    const stuck = held`select 1`.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    await stuck;
    expect(pools).toHaveLength(2);
    expect(pools[0]!.end).toHaveBeenCalledWith({ timeout: 5 });
    setMode("ok");
    const rows = await held`select 2`;
    expect(rows).toEqual([{ pool: "p2", text: "select 2", values: [] }]);
    expect(pools[1]!.end).not.toHaveBeenCalled();
  });

  it("varias consultas atoradas del mismo pool lo reemplazan una sola vez", async () => {
    const { db, pools, onDeadline } = setup("hang");
    const all = Promise.allSettled([db`select 1`, db`select 2`, db`select 3`]);
    await vi.advanceTimersByTimeAsync(15_000);
    const results = await all;
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(pools).toHaveLength(2);
    expect(pools[0]!.end).toHaveBeenCalledTimes(1);
    expect(onDeadline.mock.calls.map(([info]) => info.retired)).toEqual([true, false, false]);
  });

  it("catch y finally también miran el plazo; la consulta conserva sus métodos", async () => {
    const { db } = setup("hang");
    const query = db`select 1`;
    expect(typeof (query as unknown as { cancel: unknown }).cancel).toBe("function");
    const finallyRan = vi.fn();
    const caught = query.catch((e: unknown) => e).finally(finallyRan);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await caught).toBeInstanceOf(DbDeadlineError);
    expect(finallyRan).toHaveBeenCalled();
  });

  it("los fragmentos y ayudantes (db(lista), db.json) pasan sin plazo al pool vigente", () => {
    const { db } = setup();
    expect((db as unknown as (x: string) => unknown)("columna")).toEqual({
      fragment: "columna",
      pool: "p1",
    });
    expect(db.json({ a: 1 } as never)).toEqual({ json: { a: 1 }, pool: "p1" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("begin completo tiene el mismo plazo y retira el pool si se atora", async () => {
    const { db, pools, setMode } = setup("hang");
    const tx = db.begin(async () => "nunca").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await tx).toBeInstanceOf(DbDeadlineError);
    expect(pools).toHaveLength(2);
    setMode("ok");
    await expect(db.begin(async (t) => t)).resolves.toEqual({ pool: "p2" });
  });

  it("toAppError lo trata como interno (código estable) sin exponer detalles", () => {
    const e = toAppError(new DbDeadlineError(15_000));
    expect(e.code).toBe("internal");
    expect(causedByDeadline(e)).toBe(true);
  });
});
