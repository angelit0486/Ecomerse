import { randomUUID } from "node:crypto";
import { createServer, Socket, type Server } from "node:net";

import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DbDeadlineError, withQueryDeadline } from "@/server/db/query-deadline";

/**
 * F-08 con postgres.js real y PostgreSQL real. Entre los dos va un proxy TCP que
 * imita el fallo de Supavisor en modo transacción: en las conexiones ya abiertas,
 * la base recibe la consulta (y responde), pero la respuesta nunca llega al
 * cliente. Las conexiones nuevas funcionan normal.
 *
 * - Sin plazo, la consulta queda pendiente indefinidamente y el pool la hereda:
 *   el siguiente intento en el mismo pool también se atora (lo que pasaba en
 *   staging: 300 s y racimos de errores en el mismo servidor caliente).
 * - Con `withQueryDeadline`, falla al vencer el plazo y el siguiente intento
 *   abre un pool nuevo y responde.
 */
const target = new URL(process.env.TEST_ADMIN_DATABASE_URL!);
const GATEWAY = { user: "storefront_gateway", password: "storefront_gateway_dev_password" };

interface Pair {
  client: Socket;
  server: Socket;
  dropReplies: boolean;
}
const pairs = new Set<Pair>();
let proxy: Server;
let port = 0;

/** Desde ahora, las conexiones abiertas pierden todas las respuestas de la base. */
function loseRepliesOnOpenConnections() {
  for (const pair of pairs) pair.dropReplies = true;
}

function gatewayPool(): Sql {
  return postgres({
    host: "127.0.0.1",
    port,
    database: target.pathname.slice(1),
    ...GATEWAY,
    // Igual que createRoleClient: sin preparar, como exige Supavisor.
    prepare: false,
    max: 1,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

const flags = (db: Sql) =>
  db<{ key: string }[]>`select key from storefront.get_store_flags(${randomUUID()}::uuid)`;

beforeAll(async () => {
  proxy = createServer((client) => {
    const server = new Socket();
    const pair: Pair = { client, server, dropReplies: false };
    pairs.add(pair);
    server.connect(Number(target.port || 5432), target.hostname);
    client.on("data", (chunk) => server.write(chunk));
    server.on("data", (chunk) => {
      if (!pair.dropReplies) client.write(chunk);
    });
    const close = () => {
      pairs.delete(pair);
      client.destroy();
      server.destroy();
    };
    client.on("close", close).on("error", close);
    server.on("close", close).on("error", close);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  port = (proxy.address() as { port: number }).port;
});

afterAll(async () => {
  for (const pair of pairs) {
    pair.client.destroy();
    pair.server.destroy();
  }
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
});

describe("plazo del gateway con una respuesta perdida (F-08)", () => {
  it("sin plazo: la consulta se queda esperando y el pool hereda el problema", async () => {
    const db = gatewayPool();
    expect(await flags(db)).toEqual([]);
    loseRepliesOnOpenConnections();

    const outcome = (q: Promise<unknown>) =>
      Promise.race([
        q.then(
          () => "respondió",
          () => "falló",
        ),
        new Promise((resolve) => setTimeout(() => resolve("sigue esperando"), 3_000)),
      ]);
    expect(await outcome(flags(db))).toBe("sigue esperando");
    // Reintentar en el mismo pool no ayuda: la única conexión está atorada.
    expect(await outcome(flags(db))).toBe("sigue esperando");
    await db.end({ timeout: 0 });
  });

  it("con plazo: falla pronto y el siguiente intento responde con un pool nuevo", async () => {
    let created = 0;
    const db = withQueryDeadline(
      () => {
        created += 1;
        return gatewayPool();
      },
      { ms: 1_500, drainSeconds: 1 },
    );
    expect(await flags(db)).toEqual([]);
    loseRepliesOnOpenConnections();

    const started = Date.now();
    const error = await flags(db).then(
      () => null,
      (e: unknown) => e,
    );
    const elapsed = Date.now() - started;
    expect(error).toBeInstanceOf(DbDeadlineError);
    expect(elapsed).toBeGreaterThanOrEqual(1_400);
    expect(elapsed).toBeLessThan(3_000);

    // El reintento (lo que hace el comprador con «Reintentar») ya responde.
    expect(await flags(db)).toEqual([]);
    expect(created).toBe(2);
    await db.end({ timeout: 0 });
  });

  it("con plazo: las consultas sanas no cambian (sin falsos positivos)", async () => {
    const db = withQueryDeadline(gatewayPool, { ms: 1_500 });
    const results = await Promise.all(Array.from({ length: 20 }, () => flags(db)));
    expect(results.every((rows) => rows.length === 0)).toBe(true);
    // Una consulta lenta pero dentro del plazo termina normal.
    const [row] = await db<{ ok: number }[]>`select 1 as ok from pg_sleep(${0.5})`;
    expect(row!.ok).toBe(1);
    await db.end({ timeout: 0 });
  });
});
