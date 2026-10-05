import "server-only";

import { workerDb } from "@/server/db/role-clients";
import { createLogger } from "@/server/observability/logger";

import { getRequestMeta } from "./request-meta";

/**
 * Eventos de seguridad (GATE0 §29.2): login de staff, MFA, fallos. Se escriben
 * con `system.record_security_event` (rol system_worker). Nunca incluyen emails,
 * códigos ni tokens. Un fallo al registrar se loguea y no rompe el login.
 */
export type SecurityEventType =
  | "auth.login_code_requested"
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.mfa_enrolled"
  | "auth.mfa_verified"
  | "auth.mfa_failed"
  | "auth.logout";

const SEVERITY: Record<SecurityEventType, "info" | "warning"> = {
  "auth.login_code_requested": "info",
  "auth.login_succeeded": "info",
  "auth.login_failed": "warning",
  "auth.mfa_enrolled": "info",
  "auth.mfa_verified": "info",
  "auth.mfa_failed": "warning",
  "auth.logout": "info",
};

const log = createLogger();

export async function recordSecurityEvent(
  type: SecurityEventType,
  input: { userId?: string | null; metadata?: Record<string, string | number | boolean> } = {},
): Promise<void> {
  const meta = await getRequestMeta();
  try {
    const sql = workerDb();
    // sql.json: un string con ::jsonb llegaría como JSON string, no como objeto.
    await sql`
      select system.record_security_event(
        ${type}, ${SEVERITY[type]}, ${input.userId ?? null}::uuid, null::uuid,
        ${meta.ip}::inet, ${meta.userAgent}, ${meta.requestId}, ${sql.json(input.metadata ?? {})})`;
  } catch (error) {
    log.error("security_event.record_failed", { type, request_id: meta.requestId, err: error });
  }
}
