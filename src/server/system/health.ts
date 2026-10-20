import "server-only";

import { type ServerEnv } from "@/config/env";
import { serverEnv } from "@/server/env";

/**
 * Configuración del servidor que falta para que algo funcione, en palabras de la
 * dueña y con el paso para resolverlo. Solo mira el entorno (nunca lo imprime).
 */
export interface ConfigIssue {
  key: "image_processing" | "store_email";
  title: string;
  impact: string;
  fix: string;
}

export function configIssues(): ConfigIssue[] {
  return issuesFor(serverEnv());
}

/** Puro (para probarlo): solo lee las dos variables que importan. */
export function issuesFor(
  env: Pick<ServerEnv, "SUPABASE_SERVICE_ROLE_KEY" | "EMAIL_PROVIDER">,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    issues.push({
      key: "image_processing",
      title: "Las fotos no se pueden optimizar",
      impact: "Las fotos que subas quedan guardadas y en espera; no aparecen en la tienda.",
      fix: "Agrega SUPABASE_SERVICE_ROLE_KEY (la clave service_role de Supabase) en las variables de entorno de Vercel y vuelve a desplegar. Las fotos en espera se procesan solas después.",
    });
  }
  if (env.EMAIL_PROVIDER === "fake") {
    issues.push({
      key: "store_email",
      title: "La tienda no envía correos",
      impact: "Tus clientes no reciben avisos de pedido ni de envío.",
      fix: "Conecta Resend: EMAIL_PROVIDER=resend, RESEND_API_KEY y EMAIL_FROM en Vercel.",
    });
  }
  return issues;
}

export function imageProcessingBlocked(): boolean {
  return configIssues().some((i) => i.key === "image_processing");
}
