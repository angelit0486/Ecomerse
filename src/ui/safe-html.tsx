import "server-only";

import { sanitizeMerchantHtml } from "@/server/security/sanitize";

/**
 * Única vía para mostrar HTML del comerciante (GATE0 §44.16, T-06). Es un
 * componente de servidor: sanitiza SIEMPRE al renderizar, aunque el contenido
 * se haya sanitizado al guardar, porque la base no garantiza su origen. Es la
 * única excepción a `react/no-danger` (eslint.config.mjs).
 */
export function SafeHtml({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const clean = sanitizeMerchantHtml(html);
  if (!clean) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
