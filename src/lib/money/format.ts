/**
 * Dinero en centavos enteros (GATE0 §44.14). Solo presentación y captura en el
 * panel: el cálculo de totales vive en SQL. Nunca se usa aritmética de float.
 */

/** "199", "199.5", "1,299.90", "$1 299,90" no: solo punto decimal y comas de miles. */
const MONEY_RE = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

/** Texto del usuario → centavos; null si no es un importe válido. */
export function parseMoneyToCents(input: string): number | null {
  const text = input.trim().replace(/^\$\s*/, "");
  if (!MONEY_RE.test(text)) return null;
  const [whole, fraction = ""] = text.replace(/,/g, "").split(".");
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

/** Centavos → "199.00" / "-1.50" exacto, sin float (el signo va aparte: BigInt trunca). */
function decimal(cents: number): string {
  const value = BigInt(cents);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Centavos → "199.00" (para inputs). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return decimal(cents);
}

/** Centavos → "$199.00" en la moneda y el idioma de la tienda. */
export function formatMoney(cents: number, currency: string, locale = "es-MX"): string {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  // Intl acepta strings decimales exactos: sin pasar por float. Las ventas netas
  // pueden ser negativas (más reembolsos que ventas en el periodo).
  return formatter.format(decimal(cents) as unknown as number);
}
