import { CARD_ERROR, CARD_FORBIDDEN, cardOk, type CardState } from "@/lib/dashboard/home-insights";
import { toAppError } from "@/server/db/errors";
import { log } from "@/server/observability/logger";

/**
 * Carga una tarjeta de Inicio sin tumbar la página (Orden 1, punto 6): si la
 * consulta falla, la tarjeta queda en `error` y se registra solo el nombre de
 * la tarjeta y el código del error (nunca el mensaje de la base ni datos del
 * comprador). Un `forbidden` de la base (permiso retirado entre la carga del
 * contexto y la consulta) se muestra como «Sin permiso», no como fallo.
 */
export async function loadCard<T>(
  card: string,
  storeId: string,
  load: () => Promise<T>,
): Promise<CardState<T>> {
  try {
    return cardOk(await load());
  } catch (error) {
    const code = toAppError(error).code;
    if (code === "forbidden") return CARD_FORBIDDEN;
    log.warn("home.card_failed", { card, store_id: storeId, code });
    return CARD_ERROR;
  }
}
