import type { StoreText } from "@/lib/emails/store-texts";
import type { Sql } from "@/server/db/role-clients";
import type { Logger } from "@/server/observability/logger";

/**
 * Texto de la tienda para un correo del comprador (paso 20). Si la lectura
 * falla (p. ej. el código llegó antes que la migración), el correo sale con el
 * texto de siempre: nunca se deja de enviar por esto.
 */
export async function fetchStoreText(
  db: Sql,
  storeId: string,
  template: string,
  log: Logger,
): Promise<StoreText | null> {
  try {
    const [row] = await db<{ value: Record<string, StoreText> | null }[]>`
      select system.store_email_texts(${storeId}::uuid) as value`;
    return row?.value?.[template] ?? null;
  } catch (error) {
    log.warn("notification.store_text_failed", { store_id: storeId, template, err: error });
    return null;
  }
}
