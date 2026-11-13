/**
 * Un worker que «se cae» a media parte (ADR-064, prueba de recuperación): toma de
 * la cola el trabajo import.commit como lo haría el runner y empieza a aplicar la
 * parte en su transacción. La prueba mata este proceso a la mitad: la base
 * revierte la transacción y el trabajo queda tomado («running»), igual que si el
 * servidor se hubiera caído.
 *
 * Uso: node doomed-worker.mjs <url-del-worker> <id-del-trabajo-de-la-cola>
 */
import postgres from "postgres";

const [url, queueJobId] = process.argv.slice(2);
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const claimed = await sql`select * from system.claim_jobs('test-crash', 10)`;
const job = claimed.find((j) => j.job_id === queueJobId);
if (!job) {
  console.error("no se pudo tomar el trabajo");
  process.exit(2);
}
console.log("tomado");
await sql.begin(async (tx) => {
  await tx`select set_config('enable_seqscan', 'off', true)`;
  await tx`select system.import_commit(${job.job_payload.import_job_id})`;
  await tx`select system.import_batch_after_part(${job.job_payload.import_job_id})`;
});
console.log("terminó (no debería llegar aquí)");
process.exit(0);
