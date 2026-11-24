/**
 * CLABE (Clave Bancaria Estandarizada, 18 dígitos) dentro de las instrucciones de
 * pago manual que escribe la tienda. Solo se acepta una CLABE con dígito de
 * control válido (pesos 3-7-1 de Banxico): así un teléfono u otro número largo
 * del texto nunca se ofrece como «Copiar CLABE».
 */
const WEIGHTS = [3, 7, 1] as const;

export function isValidClabe(digits: string): boolean {
  if (!/^\d{18}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(digits[i]) * WEIGHTS[i % 3]!) % 10;
  return (10 - (sum % 10)) % 10 === Number(digits[17]);
}

/** Primera CLABE válida del texto; admite espacios o guiones entre grupos de dígitos. */
export function clabeFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const m of text.matchAll(/\d[\d \-]{16,40}\d/g)) {
    const digits = m[0].replace(/[ \-]/g, "");
    if (isValidClabe(digits)) return digits;
  }
  return null;
}

/** Para leerla en voz alta o compararla con la app del banco: 4-4-4-4-2. */
export function groupClabe(clabe: string): string {
  return clabe.replace(/(\d{4})(?=\d)/g, "$1 ");
}
