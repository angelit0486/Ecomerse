/** Marca que las plantillas de políticas traen al crearse (`app.policy_template`). */
export const POLICY_TEMPLATE_MARKER = "Plantilla en borrador";

/**
 * ¿La política sigue pendiente de revisión legal? Espejo de la regla de la
 * validación de lanzamiento (`20261014000400_store_launch.sql`): vacía, con la
 * marca de plantilla o con un párrafo que solo tiene un marcador «[…]». Si una
 * cambia, la otra también.
 */
export function needsLegalReview(bodyHtml: string): boolean {
  return (
    bodyHtml.trim() === "" ||
    bodyHtml.includes(POLICY_TEMPLATE_MARKER) ||
    /<p>\s*\[[^\]<]*\]\s*<\/p>/.test(bodyHtml)
  );
}
