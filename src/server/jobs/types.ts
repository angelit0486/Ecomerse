import type { Logger } from "@/server/observability/logger";

/** Job reclamado de la cola (GATE0 §43: contrato Job / Domain event). */
export interface JobRecord {
  id: string;
  type: string;
  storeId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface JobContext {
  log: Logger;
  /** Hora (ms epoch) en que esta ejecución del runner debe haber terminado. */
  deadline: number;
}

/** Los handlers DEBEN ser idempotentes: un job puede ejecutarse más de una vez. */
export type JobHandler = (job: JobRecord, context: JobContext) => Promise<void>;

export type JobRegistry = ReadonlyMap<string, JobHandler>;

/** Error que no debe reintentarse (el job pasa directo a `dead`). */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}

/**
 * El job no cabe en el tiempo que le queda a esta ejecución: vuelve a la cola sin
 * gastar un intento y el runner deja de reclamar (lo toma la siguiente ejecución).
 */
export class DeferJobError extends Error {
  constructor(message = "sin tiempo en esta ejecución") {
    super(message);
    this.name = "DeferJobError";
  }
}

export interface JobStore {
  claim(workerId: string, limit: number): Promise<JobRecord[]>;
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(jobId: string, workerId: string, error: string, permanent: boolean): Promise<string | null>;
  release(jobId: string, workerId: string): Promise<boolean>;
}
