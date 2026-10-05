import type { Sql } from "postgres";

import type { JobRecord, JobStore } from "./types";

interface ClaimRow {
  job_id: string;
  job_type: string;
  job_store_id: string | null;
  job_payload: Record<string, unknown>;
  job_attempts: number;
  job_max_attempts: number;
}

/** JobStore sobre las funciones `system.*` (rol system_worker). */
export function createPostgresJobStore(sql: Sql): JobStore {
  return {
    async claim(workerId, limit) {
      const rows = await sql<ClaimRow[]>`
        select * from system.claim_jobs(${workerId}, ${limit})
      `;
      return rows.map((row): JobRecord => ({
        id: row.job_id,
        type: row.job_type,
        storeId: row.job_store_id,
        payload: row.job_payload,
        attempts: row.job_attempts,
        maxAttempts: row.job_max_attempts,
      }));
    },
    async complete(jobId, workerId) {
      const [row] = await sql<{ ok: boolean }[]>`
        select system.complete_job(${jobId}, ${workerId}) as ok
      `;
      return row?.ok === true;
    },
    async fail(jobId, workerId, error, permanent) {
      const [row] = await sql<{ status: string | null }[]>`
        select system.fail_job(${jobId}, ${workerId}, ${error}, ${permanent}) as status
      `;
      return row?.status ?? null;
    },
  };
}
