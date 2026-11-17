import { isEmail } from "./types";

/**
 * Guardia de destinatarios para entornos que no son producción (desarrollo, test y
 * vista previa) cuando el canal es Resend real: solo se envía a direcciones o dominios
 * de la lista `EMAIL_ALLOWED_RECIPIENTS` ("ana@x.com,@miempresa.mx"). Así una vista
 * previa con datos de prueba nunca escribe a clientes reales por accidente.
 */
export class RecipientNotAllowedError extends Error {
  constructor() {
    super("destinatario fuera de EMAIL_ALLOWED_RECIPIENTS");
    this.name = "RecipientNotAllowedError";
  }
}

export interface RecipientAllowlist {
  emails: ReadonlySet<string>;
  domains: ReadonlySet<string>;
}

/** Entradas válidas: un email completo o `@dominio`. Lo demás se ignora. */
export function parseAllowlist(raw: string | undefined): RecipientAllowlist {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const entry = part.trim().toLowerCase();
    if (!entry) continue;
    if (/^@([a-z0-9-]+\.)+[a-z]{2,63}$/.test(entry)) domains.add(entry.slice(1));
    else if (isEmail(entry)) emails.add(entry);
  }
  return { emails, domains };
}

export function isRecipientAllowed(to: string, list: RecipientAllowlist): boolean {
  const address = to.trim().toLowerCase();
  if (!isEmail(address)) return false;
  if (list.emails.has(address)) return true;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return list.domains.has(domain);
}
