const PROBE_ORIGIN = "https://redirect-probe.invalid";

/**
 * Devuelve un destino de redirección interno seguro o `fallback` (GATE0 T-18).
 *
 * Solo acepta rutas relativas del mismo origen: deben empezar con "/" y no con
 * "//" ni "/\" (protocol-relative), sin barras invertidas ni caracteres de
 * control (los navegadores eliminan \t \n \r, y "/\t/evil.com" se convierte en
 * "//evil.com"). Se resuelve contra un origen de prueba y se exige el mismo origen.
 */
export function safeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string") return fallback;
  if (target.length === 0 || target.length > 2048) return fallback;
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  if (target.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(target)) return fallback;

  try {
    const url = new URL(target, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
