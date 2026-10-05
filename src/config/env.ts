import { z } from "zod";

/**
 * Variables de entorno del servidor (GATE0 §29 project structure: config/env.ts).
 *
 * Regla: solo se declaran las variables que el código ya usa. Cada fase agrega
 * las suyas (p. ej. GATEWAY_DATABASE_URL en la Fase 2). `next.config.ts` valida
 * este esquema al arrancar el build: si falta una variable, el build falla.
 *
 * Este módulo es puro (sin `server-only`) porque lo importa next.config.ts.
 * En código de aplicación se accede mediante `@/server/env`.
 */
export const serverEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "preview", "production"]),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Conexión del rol system_worker (Supavisor, modo transacción). */
  WORKER_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Secreto que Vercel Cron envía como `Authorization: Bearer …`. */
  CRON_SECRET: z.string().min(32),
  /** Secreto HMAC para disparos firmados del runner de jobs (pg_cron + pg_net). */
  JOBS_HMAC_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Variables de entorno inválidas o ausentes:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Valida el entorno. El mensaje de error nombra las variables y el problema,
 * pero NUNCA incluye sus valores.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const key = issue.path.join(".") || "(raíz)";
    const raw = source[key];
    return `${key}: ${raw === undefined || raw === "" ? "requerida" : "valor inválido"}`;
  });
  throw new EnvValidationError(issues);
}
