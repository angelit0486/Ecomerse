import type { Sql } from "postgres";

/**
 * Plazo máximo de cada consulta del cliente de la tienda (F-08, auditoría
 * 2026-11-24).
 *
 * Por qué existe: a través de Supavisor en modo transacción, una respuesta de la
 * base a veces nunca llega al cliente. postgres.js manda cada consulta con
 * parámetros y sin preparar en dos escrituras (Parse+Describe+Flush, luego
 * Bind+Execute+Sync); si el pooler suelta el backend entre las dos o pierde la
 * respuesta, la promesa queda pendiente para siempre. La base corta su lado a
 * los 5 s (`statement_timeout` de `storefront_gateway`), pero el cliente no se
 * entera: la página o el «Confirmar pedido» esperaban hasta que Vercel mataba la
 * función (300 s antes de `maxDuration`). Además, la conexión atorada se queda
 * ocupada en el pool del servidor caliente y las siguientes visitas heredan el
 * problema (los «racimos» de errores en el mismo segundo).
 *
 * Qué hace: si una consulta no responde en `ms`, la promesa se rechaza con
 * `DbDeadlineError` y el pool entero se reemplaza por uno nuevo; el viejo se
 * cierra con gracia (`end({ timeout })`), así las consultas sanas que iban en él
 * terminan y la atorada se destruye. Quien guardó la referencia del cliente
 * (`const db = gatewayDb()`) sigue funcionando: el proxy siempre apunta al pool
 * vigente. Una consulta que sí responde a tiempo se comporta exactamente igual
 * que antes.
 */
export class DbDeadlineError extends Error {
  readonly code = "PRUVA_DB_DEADLINE";
  constructor(readonly ms: number) {
    super(`La base no respondió en ${ms} ms.`);
    this.name = "DbDeadlineError";
  }
}

export function isDbDeadlineError(error: unknown): error is DbDeadlineError {
  return (
    error instanceof DbDeadlineError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "PRUVA_DB_DEADLINE")
  );
}

/** ¿El error (o alguna de sus causas) es un plazo vencido? `toAppError` lo envuelve en `cause`. */
export function causedByDeadline(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (isDbDeadlineError(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface DeadlineOptions {
  /** Plazo de cada consulta (y de cada `begin` completo), en milisegundos. */
  ms: number;
  /** Segundos que el pool retirado espera a sus consultas sanas antes de cerrarse. */
  drainSeconds?: number;
  /** Aviso cuando se cumple un plazo (para el log; nunca recibe la cadena de conexión). */
  onDeadline?: (info: { ms: number; retired: boolean }) => void;
}

type Thenable = { then: (onFulfilled?: unknown, onRejected?: unknown) => unknown };

function isTemplateCall(args: unknown[]): boolean {
  const first = args[0];
  return Array.isArray(first) && Object.hasOwn(first, "raw");
}

/** Corre `promise` contra el plazo; al vencer, avisa y rechaza. */
function race<T>(promise: PromiseLike<T>, ms: number, expire: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      expire();
      reject(new DbDeadlineError(ms));
    }, ms);
    // Sin unref el temporizador no retiene el proceso más allá de la consulta.
    (timer as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Cliente postgres.js con plazo por consulta y reemplazo del pool atorado.
 * `factory` crea un pool nuevo; se llama una vez al inicio y otra cada vez que
 * se retira uno.
 */
export function withQueryDeadline(factory: () => Sql, options: DeadlineOptions): Sql {
  const { ms, drainSeconds = 5, onDeadline } = options;
  let current = factory();

  const retire = (stuck: Sql) => {
    const retired = current === stuck;
    if (retired) {
      current = factory();
      // Las consultas sanas del pool viejo tienen `drainSeconds` para terminar.
      void stuck.end({ timeout: drainSeconds }).catch(() => {});
    }
    onDeadline?.({ ms, retired });
  };

  /**
   * La consulta de postgres.js sigue siendo la misma (`.values()`, `.cancel()`…);
   * solo `then`, `catch` y `finally` pasan por el plazo.
   */
  const arm = <Q extends Thenable>(query: Q, pool: Sql): Q => {
    const original = query.then.bind(query) as (a?: unknown, b?: unknown) => PromiseLike<unknown>;
    let raced: Promise<unknown> | undefined;
    const settle = () =>
      (raced ??= race({ then: original } as PromiseLike<unknown>, ms, () => retire(pool)));
    const define = (name: string, value: (...args: never[]) => unknown) =>
      Object.defineProperty(query, name, { configurable: true, writable: true, value });
    define("then", (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      settle().then(onFulfilled, onRejected),
    );
    define("catch", (onRejected?: (e: unknown) => unknown) => settle().catch(onRejected));
    define("finally", (onFinally?: () => void) => settle().finally(onFinally));
    return query;
  };

  const target = function deadlineSql() {} as unknown as Sql;
  return new Proxy(target, {
    apply(_target, _this, args: unknown[]) {
      const pool = current;
      const result = Reflect.apply(
        pool as unknown as (...a: unknown[]) => unknown,
        undefined,
        args,
      );
      // Solo las plantillas (`db\`select …\``) son consultas; `db(lista)` o
      // `db("columna")` son fragmentos para otra plantilla y no se tocan.
      return isTemplateCall(args) ? arm(result as Thenable, pool) : result;
    },
    get(_target, prop) {
      const pool = current;
      if (prop === "begin") {
        return (...args: unknown[]) =>
          race((pool.begin as (...a: unknown[]) => Promise<unknown>).apply(pool, args), ms, () =>
            retire(pool),
          );
      }
      const value = Reflect.get(pool, prop, pool) as unknown;
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(pool)
        : value;
    },
  });
}
