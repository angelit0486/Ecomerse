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
  /**
   * Stripe Billing (ADR-044): secreto del endpoint de webhooks del COBRO de las
   * suscripciones (distinto del de Connect). Sin él, «Pagar con tarjeta» no se ofrece.
   */
  STRIPE_BILLING_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[A-Za-z0-9]{10,}$/)
    .optional(),
  /** Solo pruebas: API de Stripe simulada. */
  STRIPE_API_BASE: z.url({ protocol: /^https?$/ }).optional(),
  /**
   * Mercado Pago de la PLATAFORMA (ADR-028): access token y clave secreta de la
   * firma de webhooks («Tus integraciones» → Webhooks). Opcionales hasta que el
   * propietario los configure; sin ellos el método Mercado Pago no se ofrece.
   */
  MERCADOPAGO_ACCESS_TOKEN: z
    .string()
    .regex(/^(APP_USR|TEST)-[A-Za-z0-9-]{20,300}$/)
    .optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9]{16,128}$/)
    .optional(),
  /** Solo pruebas: API de Mercado Pago simulada. */
  MERCADOPAGO_API_BASE: z.url({ protocol: /^https?$/ }).optional(),
  /**
   * ADR-041: aplicación de Mercado Pago para que cada comercio conecte SU cuenta
   * (OAuth). Con las tres, el dinero de cada tienda llega a la cuenta del comercio.
   */
  MERCADOPAGO_CLIENT_ID: z
    .string()
    .regex(/^[0-9]{6,25}$/)
    .optional(),
  MERCADOPAGO_CLIENT_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9]{16,128}$/)
    .optional(),
  /** Clave que cifra las llaves de los comercios en la base: 32 bytes en base64. */
  PAYMENT_CREDENTIALS_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .optional(),
  /** Solo pruebas: pantalla de autorización de Mercado Pago simulada. */
  MERCADOPAGO_AUTH_BASE: z.url({ protocol: /^https?$/ }).optional(),
  /**
   * Dominios propios (E16): token de Vercel con acceso SOLO a este proyecto e id
   * del proyecto (y del equipo, si aplica). Opcionales: sin ellos los dominios
   * quedan «en verificación» y el panel dice que falta configurarlo.
   */
  VERCEL_DOMAINS_TOKEN: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,200}$/)
    .optional(),
  VERCEL_PROJECT_ID: z
    .string()
    .regex(/^prj_[A-Za-z0-9]{10,64}$/)
    .optional(),
  VERCEL_TEAM_ID: z
    .string()
    .regex(/^team_[A-Za-z0-9]{10,64}$/)
    .optional(),
  /** Solo pruebas: API de Vercel simulada. */
  VERCEL_API_BASE: z.url({ protocol: /^https?$/ }).optional(),
  /** Registros que el panel indica (los da Vercel al agregar el dominio al proyecto). */
  DOMAIN_CNAME_TARGET: z
    .string()
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,63}$/)
    .optional(),
  DOMAIN_APEX_A: z.ipv4().optional(),
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
  // Firma de los webhooks de Resend (rebotes y quejas). Opcional.
  RESEND_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[A-Za-z0-9+/=]{16,}$/)
    .optional(),
  MAILPIT_URL: z.url({ protocol: /^https?$/ }).default("http://127.0.0.1:8025"),
  /**
   * Solo vista previa (D-F9-17): enlaces a las tiendas de demostración que muestra la
   * portada del panel, "Etiqueta|https://host,…". En producción se ignora.
   */
  PREVIEW_STORE_LINKS: z.string().max(2000).optional(),
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
  // En la vista previa es opcional (D-F9-17): sin ella solo fallan, con un error
  // claro, el reset de MFA y el worker de medios; producción la exige.
  if (env.APP_ENV === "production" && !env.SUPABASE_SERVICE_ROLE_KEY) {
    ctx.addIssue({ code: "custom", path: ["SUPABASE_SERVICE_ROLE_KEY"], message: "requerida" });
  }
  // Mercado Pago va completo o no va: un token sin secreto aceptaría cobros sin poder confirmarlos.
  if (!env.MERCADOPAGO_ACCESS_TOKEN !== !env.MERCADOPAGO_WEBHOOK_SECRET) {
    ctx.addIssue({ code: "custom", path: ["MERCADOPAGO_WEBHOOK_SECRET"], message: "van juntas" });
  }
  // OAuth va completo y sobre la integración de plataforma (su webhook y su token).
  const oauth = [
    env.MERCADOPAGO_CLIENT_ID,
    env.MERCADOPAGO_CLIENT_SECRET,
    env.PAYMENT_CREDENTIALS_KEY,
  ];
  if (oauth.some(Boolean) && !oauth.every(Boolean)) {
    ctx.addIssue({ code: "custom", path: ["PAYMENT_CREDENTIALS_KEY"], message: "van juntas" });
  }
  if (oauth.every(Boolean) && !env.MERCADOPAGO_ACCESS_TOKEN) {
    ctx.addIssue({
      code: "custom",
      path: ["MERCADOPAGO_ACCESS_TOKEN"],
      message: "requerida con OAuth",
    });
  }
  // Vercel inyecta VERCEL_PROJECT_ID en cada build y ejecución: sola no significa
  // nada. Solo el token la exige.
  if (env.VERCEL_DOMAINS_TOKEN && !env.VERCEL_PROJECT_ID) {
    ctx.addIssue({
      code: "custom",
      path: ["VERCEL_PROJECT_ID"],
      message: "requerida con VERCEL_DOMAINS_TOKEN",
    });
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
  // `KEY=` (como en .env.example) llega como "": para el esquema es ausente, así
  // una opcional vacía no rompe el arranque y una requerida vacía sigue fallando.
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = serverEnvRules.safeParse(present);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const key = issue.path.join(".") || "(raíz)";
    const raw = source[key];
    if (issue.code === "custom") return `${key}: ${issue.message}`;
    return `${key}: ${raw === undefined || raw === "" ? "requerida" : "valor inválido"}`;
  });
  throw new EnvValidationError(issues);
}
