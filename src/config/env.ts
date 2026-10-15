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
  /** URL pública de la API de Supabase (en local: `pnpm stack env`). */
  NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  /** Clave anónima (publicable): solo identifica el proyecto; RLS protege los datos. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  /** Conexión del rol storefront_gateway (solo EXECUTE de storefront.*). */
  GATEWAY_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Host del panel (sin protocolo; puerto opcional). Cualquier otro host es de tienda. */
  APP_HOSTNAME: z.string().regex(/^[a-z0-9.-]+(:\d{1,5})?$/),
  /** Secreto HMAC de los tokens de vista previa de tiendas en borrador (CF-09). */
  PREVIEW_HMAC_SECRET: z.string().min(32),
  /**
   * HMAC de los enlaces de pedido: token del invitado (derivado de la clave de
   * idempotencia, la base solo guarda su hash) y la página del pago simulado.
   */
  ORDER_LINK_SECRET: z.string().min(32),
  /**
   * Stripe Connect de la PLATAFORMA (A-01): clave secreta y secreto del endpoint de
   * webhooks Connect. Opcionales hasta que el propietario cree la cuenta; sin ellas
   * el método Stripe no se ofrece.
   */
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_[A-Za-z0-9]{10,}$/)
    .optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[A-Za-z0-9]{10,}$/)
    .optional(),
  /** Solo pruebas: API de Stripe simulada. */
  STRIPE_API_BASE: z.url({ protocol: /^https?$/ }).optional(),
  // Send Email Hook de Supabase Auth (Standard Webhooks): v1,whsec_<base64>.
  SEND_EMAIL_HOOK_SECRET: z
    .string()
    .regex(/^v1,whsec_[A-Za-z0-9+/=]{24,}$/)
    .optional(),
  /** Origen público del panel para enlaces en emails (p. ej. https://app.ejemplo.com). */
  APP_URL: z.url({ protocol: /^https?$/ }),
  /** Canal de email (GATE0 §27.1): resend en producción; mailpit o fake en local/CI. */
  EMAIL_PROVIDER: z.enum(["resend", "mailpit", "fake"]),
  /** Remitente de los emails de plataforma: "Nombre <no-reply@dominio>". */
  EMAIL_FROM: z.string().regex(/^[^<>]{1,80} <[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/),
  RESEND_API_KEY: z.string().min(10).optional(),
  MAILPIT_URL: z.url({ protocol: /^https?$/ }).default("http://127.0.0.1:8025"),
  /**
   * service_role: SOLO para src/server/privileged (lista blanca §11.5: Auth Admin
   * para el reset de MFA, Storage Admin en fases posteriores). Nunca toca tablas.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
});

/**
 * Reglas entre variables: una configuración inválida nunca llega a producción
 * (preview/production exigen Resend con su clave y enlaces https).
 */
const serverEnvRules = serverEnvSchema.superRefine((env, ctx) => {
  const deployed = env.APP_ENV === "production" || env.APP_ENV === "preview";
  // Producción siempre con Resend. La vista previa puede no enviar nada
  // (`fake`): la demostración pública nunca escribe a direcciones reales (D-F9-17).
  const emailOk =
    env.EMAIL_PROVIDER === "resend" || (env.APP_ENV === "preview" && env.EMAIL_PROVIDER === "fake");
  if (deployed && !emailOk) {
    ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "resend obligatorio" });
  }
  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "requerida" });
  }
  if (deployed && !env.SUPABASE_SERVICE_ROLE_KEY) {
    ctx.addIssue({ code: "custom", path: ["SUPABASE_SERVICE_ROLE_KEY"], message: "requerida" });
  }
  if (deployed && !env.APP_URL.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "https obligatorio" });
  }
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
  const result = serverEnvRules.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const key = issue.path.join(".") || "(raíz)";
    const raw = source[key];
    if (issue.code === "custom") return `${key}: ${issue.message}`;
    return `${key}: ${raw === undefined || raw === "" ? "requerida" : "valor inválido"}`;
  });
  throw new EnvValidationError(issues);
}
