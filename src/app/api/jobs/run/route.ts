import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { AppError, errorResponse } from "@/server/errors";
import { authorizeJobRunner } from "@/server/jobs/authorize";
import { jobRegistry } from "@/server/jobs/registry";
import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runner de la cola de jobs (GATE0 §28.4). Invocado cada minuto por Vercel Cron
 * (GET + Bearer) o por pg_cron + pg_net (POST firmado con HMAC).
 */
async function handle(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request.headers);
  const reqLog = log.child({ request_id: requestId, route: "jobs.run" });

  try {
    const env = serverEnv();
    const rawBody = request.method === "POST" ? await request.text() : "";
    const auth = authorizeJobRunner({
      authorization: request.headers.get("authorization"),
      timestamp: request.headers.get("x-jobs-timestamp"),
      signature: request.headers.get("x-jobs-signature"),
      rawBody,
      cronSecret: env.CRON_SECRET,
      hmacSecret: env.JOBS_HMAC_SECRET,
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    if (!auth.ok) {
      reqLog.warn("Invocación no autorizada del runner de jobs");
      return errorResponse(new AppError("unauthenticated"), requestId);
    }

    const workerId = `${process.env.VERCEL_REGION ?? "local"}:${crypto.randomUUID()}`;
    const db = workerDb();
    // Mantenimiento periódico (purga diaria de medios): idempotente por día.
    await db`select system.enqueue_maintenance()`;
    const result = await runJobs({
      store: createPostgresJobStore(db),
      registry: jobRegistry,
      workerId,
      log: reqLog.child({ worker_id: workerId }),
      deadlineMs: 45_000,
      // Un job por reclamo: el plazo se comprueba antes de cada uno y un medio
      // pesado (≤ 15 s con el timeout de sharp) no arrastra a otros (Gate F3).
      batchSize: 1,
    });

    reqLog.info("Runner de jobs completado", { method: auth.method, ...result });
    return Response.json({ ok: true, data: result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    reqLog.error("Fallo del runner de jobs", { error });
    return errorResponse(error, requestId);
  }
}

export const GET = handle;
export const POST = handle;
