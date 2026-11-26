/**
 * «Marcar agotado» y actualización rápida del inventario (panel, 2026-11-26).
 * Funciones puras: qué hacer con cada variante y qué filas cambiaron.
 *
 * Agotado = DISPONIBLE en 0, no «en mano» en 0: si hay piezas apartadas para
 * pedidos ya hechos, en mano queda igual a lo apartado (bajar más dejaría el
 * disponible en negativo y esos pedidos sin mercancía). Todo pasa por
 * `inventory_adjust` (movimiento con motivo, auditoría e idempotencia; GATE0 §44.10).
 */
export interface StockRow {
  variant_id: string;
  track_inventory: boolean;
  inventory_policy: "deny" | "continue";
  on_hand: number;
  reserved: number;
}

export type SoldOutPlan =
  | { kind: "set"; target: number; keepsSelling: boolean }
  | { kind: "already" }
  | { kind: "untracked" };

export function soldOutPlan(row: StockRow): SoldOutPlan {
  if (!row.track_inventory) return { kind: "untracked" };
  if (row.on_hand - row.reserved <= 0) return { kind: "already" };
  // «Se vende sin existencias»: queda en 0 disponible, pero la tienda la sigue vendiendo.
  return { kind: "set", target: row.reserved, keepsSelling: row.inventory_policy === "continue" };
}

/**
 * Clave de idempotencia: `nonce` es de un solo uso (uno por página dibujada o
 * por acción). Las claves son permanentes en la base, así que no se arma solo
 * con las existencias: agotar, reponer y volver a agotar repetiría la clave y la
 * segunda vez no haría nada.
 */
export function soldOutKey(row: StockRow, nonce: string): string {
  return `agotado-${nonce}-${row.variant_id}`;
}

export const MAX_QUICK_ROWS = 100;
export const MAX_STOCK = 1_000_000;

export interface QuickChange {
  variantId: string;
  from: number;
  to: number;
}

/**
 * Del formulario de la página de inventario (`stock:<id>`, `orig:<id>` y
 * `res:<id>`), las filas que cambiaron y las que traen un número no válido (o
 * menor que lo apartado para pedidos: dejaría el disponible en negativo). Las que
 * no cambian no se mandan: la base rechaza un ajuste sin diferencia.
 */
export function quickChanges(entries: Iterable<[string, FormDataEntryValue]>): {
  changes: QuickChange[];
  invalid: string[];
} {
  const values = new Map<string, string>();
  const originals = new Map<string, number>();
  const reserved = new Map<string, number>();
  for (const [key, value] of entries) {
    if (typeof value !== "string") continue;
    if (key.startsWith("stock:")) values.set(key.slice(6), value.trim());
    else if (key.startsWith("orig:")) originals.set(key.slice(5), Number(value));
    else if (key.startsWith("res:")) reserved.set(key.slice(4), Number(value));
  }
  const changes: QuickChange[] = [];
  const invalid: string[] = [];
  for (const [variantId, raw] of values) {
    const from = originals.get(variantId);
    if (from === undefined || !Number.isInteger(from)) {
      invalid.push(variantId);
      continue;
    }
    if (raw === "") continue;
    if (!/^\d+$/.test(raw) || Number(raw) > MAX_STOCK) {
      invalid.push(variantId);
      continue;
    }
    const to = Number(raw);
    if (to < (reserved.get(variantId) ?? 0)) {
      invalid.push(variantId);
      continue;
    }
    if (to !== from) changes.push({ variantId, from, to });
  }
  return { changes: changes.slice(0, MAX_QUICK_ROWS), invalid };
}

export interface SoldOutResult {
  marked: number;
  already: number;
  untracked: number;
  /** Marcadas pero con «se vende sin existencias»: la tienda las sigue vendiendo. */
  keepsSelling: number;
  failed: number;
}

/** Mensaje en español del resultado (nunca dice «listo» si no se marcó nada). */
export function soldOutMessage(r: SoldOutResult): { ok: boolean; message: string } {
  const parts: string[] = [];
  if (r.marked > 0) {
    parts.push(
      r.marked === 1
        ? "1 variante marcada como agotada."
        : `${r.marked} variantes marcadas como agotadas.`,
    );
  }
  if (r.already > 0)
    parts.push(
      `${r.already} ya estaba${r.already === 1 ? "" : "n"} agotada${r.already === 1 ? "" : "s"}.`,
    );
  if (r.untracked > 0) {
    parts.push(
      `${r.untracked} sin seguimiento de inventario (siempre disponible${r.untracked === 1 ? "" : "s"}): actívalo en el producto para poder agotarla${r.untracked === 1 ? "" : "s"}.`,
    );
  }
  if (r.keepsSelling > 0) {
    parts.push(
      `Atención: ${r.keepsSelling} se sigue${r.keepsSelling === 1 ? "" : "n"} vendiendo sin existencias (ajuste de la variante).`,
    );
  }
  if (r.failed > 0) parts.push(`${r.failed} no se pudo marcar; inténtalo de nuevo.`);
  return {
    ok: r.marked > 0 || (r.failed === 0 && r.already > 0),
    message: parts.join(" ") || "No había nada que marcar.",
  };
}
