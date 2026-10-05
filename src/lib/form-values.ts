/**
 * Valores enviados, para devolverlos con un error: React 19 reinicia el
 * formulario al terminar la acción y, sin esto, el usuario perdería lo escrito.
 */
export function formValues(formData: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));
}

/** ¿Algún campo con error no tiene dónde mostrarse? Entonces va el error general. */
export function hasUnrenderedFieldError(
  fields: Record<string, string> | undefined,
  rendered: readonly string[],
): boolean {
  return !fields || Object.keys(fields).some((k) => !rendered.includes(k));
}
