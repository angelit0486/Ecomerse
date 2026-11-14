import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * H5 (Orden 10, mensaje 7): scripts/ops/cola/diagnostico-pg_cron.sql distingue
 * cada falla del disparador pg_cron + pg_net. Aquí no hay pg_cron ni pg_net: se
 * prueba contra tablas con las mismas columnas que documentan (cron.job,
 * cron.job_run_details, net.http_request_queue, net._http_response) en una base
 * desechable. Prueba la lógica de clasificación, no Supabase [NO VERIFICADO allá].
 */
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL!;
const dbName = `pruva_diag_${process.pid}`;
const root = postgres(adminUrl, { max: 1, onnotice: () => {} });
let db: postgres.Sql;
const SCRIPT = readFileSync(
  join(process.cwd(), "scripts/ops/cola/diagnostico-pg_cron.sql"),
  "utf8",
);

type Row = { senal: string; valor: string; esperado: string; ok: boolean; caso: string };
const diagnose = async () => (await db.unsafe<Row[]>(SCRIPT)).map((r) => ({ ...r }));
const failing = async () => (await diagnose()).filter((r) => !r.ok).map((r) => r.caso.slice(0, 1));

const RUNNER_OK = '{"ok":true,"data":{"claimed":1,"succeeded":1}}';
const RUNNER_401 = '{"ok":false,"error":{"code":"unauthenticated","message":"…","request_id":"r"}}';

/** 30 corridas de pg_cron, una por minuto, cada una con la respuesta dada. */
async function scenario(response: {
  status_code: number | null;
  content?: string | null;
  timed_out?: boolean;
  error_msg?: string | null;
}) {
  await db`truncate cron.job_run_details, net._http_response, net.http_request_queue, system.jobs`;
  for (let minute = 1; minute <= 30; minute += 1) {
    const at = `now() - interval '${minute} minutes' + interval '10 seconds'`;
    await db.unsafe(`insert into cron.job_run_details (jobid, runid, status, return_message, start_time)
                     values (1, ${minute}, 'succeeded', '1 row', ${at})`);
    await db`insert into net._http_response (id, status_code, content, timed_out, error_msg, created)
             values (${minute}, ${response.status_code}, ${response.content ?? null}, ${response.timed_out ?? false},
                     ${response.error_msg ?? null}, now() - make_interval(mins => ${minute}) + interval '20 seconds')`;
  }
  // La cola avanza: un trabajo terminado hace 5 min, ninguno atrasado.
  await db`insert into system.jobs (status, run_after, finished_at) values ('succeeded', now() - interval '6 minutes', now() - interval '5 minutes')`;
}

beforeAll(async () => {
  await root.unsafe(`drop database if exists ${dbName}`);
  await root.unsafe(`create database ${dbName}`);
  db = postgres(adminUrl.replace(/\/[^/]+$/, `/${dbName}`), { max: 1, onnotice: () => {} });
  await db.unsafe(`
    create schema cron; create schema net; create schema system;
    create table cron.job (jobid bigint primary key, jobname text, schedule text, command text, active boolean);
    create table cron.job_run_details (jobid bigint, runid bigint, status text, return_message text,
                                       start_time timestamptz, end_time timestamptz);
    create table net.http_request_queue (id bigint, method text, url text);
    create table net._http_response (id bigint, status_code integer, content_type text, content text,
                                     timed_out boolean, error_msg text, created timestamptz);
    create table system.jobs (status text, run_after timestamptz, finished_at timestamptz);
    insert into cron.job values (1, 'pruva-jobs-runner', '* * * * *', 'select 1', true);
  `);
});
afterAll(async () => {
  await db?.end();
  await root.unsafe(`drop database if exists ${dbName}`);
  await root.end();
});

describe("H5: diagnóstico del disparador pg_cron + pg_net", () => {
  it("todo en verde cuando cada corrida recibe un 200 del runner y la cola avanza", async () => {
    await scenario({ status_code: 200, content: RUNNER_OK });
    expect(await failing()).toEqual([]);
    expect(await diagnose()).toHaveLength(13);
  });

  it("401 del runner (firma o secreto distinto)", async () => {
    await scenario({ status_code: 401, content: RUNNER_401 });
    expect(await failing()).toEqual(["G", "J"]);
  });

  it("403 sin JSON (protección de Vercel o firewall)", async () => {
    await scenario({
      status_code: 403,
      content: "<!doctype html><title>Authentication Required</title>",
    });
    expect(await failing()).toEqual(["H", "J"]);
  });

  it("5xx", async () => {
    await scenario({ status_code: 500, content: '{"ok":false,"error":{"code":"internal"}}' });
    expect(await failing()).toEqual(["I", "J"]);
  });

  it("tiempo agotado", async () => {
    await scenario({
      status_code: null,
      timed_out: true,
      error_msg: "Timeout of 60000 ms reached",
    });
    expect(await failing()).toEqual(["F", "J"]);
  });

  it("sin respuesta (error de red)", async () => {
    await scenario({ status_code: null, error_msg: "Couldn't resolve host name" });
    expect(await failing()).toEqual(["E", "J"]);
  });

  it("corridas sin respuesta registrada", async () => {
    await scenario({ status_code: 200, content: RUNNER_OK });
    await db`delete from net._http_response where id > 5`;
    expect(await failing()).toEqual(["D"]);
  });

  it("pg_net no envía (solicitudes acumuladas) y pg_cron falla", async () => {
    await scenario({ status_code: 200, content: RUNNER_OK });
    await db`insert into net.http_request_queue (id) select g from generate_series(1, 5) g`;
    await db`update cron.job_run_details set status = 'failed' where runid <= 3`;
    expect(await failing()).toEqual(["B", "C"]);
  });

  it("pg_cron sin el trabajo o detenido", async () => {
    await scenario({ status_code: 200, content: RUNNER_OK });
    await db`update cron.job set active = false`;
    await db`delete from cron.job_run_details where runid > 3`;
    expect(await failing()).toEqual(["A", "A"]);
    await db`update cron.job set active = true`;
  });

  it("éxito sin avance: 200 del runner pero la cola atrasada y nada terminado", async () => {
    await scenario({ status_code: 200, content: RUNNER_OK });
    await db`truncate system.jobs`;
    await db`insert into system.jobs (status, run_after) values ('queued', now() - interval '20 minutes')`;
    expect(await failing()).toEqual(["K", "L"]);
  });

  it("no lee encabezados ni el secreto y no escribe", () => {
    const code = SCRIPT.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\bheaders\b|decrypted_secrets|vault\.|hmac\(/i);
    expect(code).not.toMatch(
      /\b(insert|update|delete|alter|drop|create|grant|truncate|schedule)\b/i,
    );
  });
});
