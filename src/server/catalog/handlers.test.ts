import { describe, expect, it } from "vitest";

import type { Sql } from "@/server/db/role-clients";
import type { JobRecord } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";

import { createCatalogHandlers } from "./handlers";

/** Base falsa: devuelve las filas de system.publish_scheduled_products. */
function fakeDb(rows: { store_id: string; published: boolean }[]) {
  const queries: string[] = [];
  const db = ((strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return Promise.resolve(rows);
  }) as unknown as Sql;
  return { db, queries };
}

const job = { id: "j", type: "catalog.publish_scheduled", payload: {} } as unknown as JobRecord;

describe("catalog.publish_scheduled", () => {
  it("invalida la caché una vez por tienda con productos publicados", async () => {
    const { db, queries } = fakeDb([
      { store_id: "a", published: true },
      { store_id: "a", published: true },
      { store_id: "b", published: false },
      { store_id: "c", published: true },
    ]);
    const invalidated: string[] = [];
    const lines: string[] = [];
    const [type, handler] = createCatalogHandlers({
      db,
      onPublished: (s) => invalidated.push(s),
    })[0]!;
    expect(type).toBe("catalog.publish_scheduled");
    await handler(job, {
      log: createLogger({ sink: (l) => lines.push(l) }),
      deadline: Date.now() + 1000,
    });
    expect(queries[0]).toContain("system.publish_scheduled_products");
    expect(invalidated.sort()).toEqual(["a", "c"]);
    expect(lines.join("\n")).toContain('"published":3');
    expect(lines.join("\n")).toContain('"failed":1');
  });

  it("sin productos vencidos no invalida ni registra nada", async () => {
    const { db } = fakeDb([]);
    const invalidated: string[] = [];
    const lines: string[] = [];
    const [, handler] = createCatalogHandlers({ db, onPublished: (s) => invalidated.push(s) })[0]!;
    await handler(job, {
      log: createLogger({ sink: (l) => lines.push(l) }),
      deadline: Date.now() + 1000,
    });
    expect(invalidated).toEqual([]);
    expect(lines).toEqual([]);
  });
});
