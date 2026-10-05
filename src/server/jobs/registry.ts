import type { JobHandler, JobRegistry } from "./types";

/**
 * Registro de handlers por tipo de job. Fase 1: vacío (aún no hay eventos de
 * dominio). Cada módulo registra aquí sus handlers en la fase que los introduce;
 * un tipo sin handler termina en `dead` con `unknown_job_type`.
 */
const handlers: Array<[string, JobHandler]> = [];

export const jobRegistry: JobRegistry = new Map(handlers);
