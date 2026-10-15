import { AppError } from "@/server/errors";

/**
 * Detalle de los errores de las RPC de apariencia (F9-DESIGN §4): `detail` dice
 * qué regla falló y `hint` trae la lista (claves de contraste, referencias
 * `<sección>:<campo>` o códigos `compliance_forbidden_term:<regla>@<sección>`).
 * Solo se aceptan formas conocidas: nada de texto libre de la base llega a la UI.
 */
export interface ThemeRpcError {
  code: string;
  detail?: string;
  items: string[];
}

const DETAIL_RE = /^[a-z_]{1,40}$/;
const ITEM_RE = /^[a-z0-9_.:@-]{1,120}$/;

export function themeRpcError(error: unknown): ThemeRpcError {
  const code = error instanceof AppError ? error.code : "internal";
  const cause = error instanceof AppError ? error.cause : error;
  const c = (cause && typeof cause === "object" ? cause : {}) as {
    details?: unknown;
    detail?: unknown;
    hint?: unknown;
  };
  const rawDetail = typeof c.details === "string" ? c.details : c.detail;
  const detail = typeof rawDetail === "string" && DETAIL_RE.test(rawDetail) ? rawDetail : undefined;
  const items =
    typeof c.hint === "string" && c.hint.length <= 4000
      ? c.hint.split(",").filter((i) => ITEM_RE.test(i))
      : [];
  return { code, ...(detail ? { detail } : {}), items };
}
