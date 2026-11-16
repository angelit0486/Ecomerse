import type { Sql } from "@/server/db/role-clients";

/**
 * Doble mínimo del cliente `postgres` para pruebas unitarias: registra el texto de
 * cada consulta y responde con lo que devuelva `respond` (por defecto, sin filas).
 */
export function sqlRecorder(respond: (query: string, values: unknown[]) => unknown[] = () => []) {
  const queries: string[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    const promise = Promise.resolve(respond(query, values)) as Promise<unknown[]> & {
      catch: Promise<unknown[]>["catch"];
    };
    return promise;
  }) as unknown as Sql & { json: (v: unknown) => unknown };
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
  return { db: fn as Sql, queries };
}
