import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { AppError } from "@/server/errors";

/**
 * Cifrado de secretos de terceros en reposo (ADR-041): AES-256-GCM con una clave
 * que vive solo en el entorno (`PAYMENT_CREDENTIALS_KEY`, 32 bytes en base64). La
 * base guarda únicamente el sobre `v1.<iv>.<tag>.<ciphertext>` (base64url): un
 * respaldo o una lectura de la base no basta para usar una llave.
 *
 * `context` (p. ej. el id de la cuenta de pago) entra como dato autenticado: un
 * sobre copiado a otra cuenta no se descifra.
 */
const VERSION = "v1";

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32)
    throw new AppError("internal", "PAYMENT_CREDENTIALS_KEY debe tener 32 bytes");
  return key;
}

export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ct]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function open(key: Buffer, envelope: string, context: string): string {
  const [version, iv, tag, ct] = envelope.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new AppError("internal", "Sobre inválido");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    // Clave equivocada, sobre alterado o de otra cuenta: nunca se devuelve nada parcial.
    throw new AppError("internal", "No se pudo descifrar", { cause: error });
  }
}

/** Subclave derivada para otro propósito (p. ej. firmar el estado de OAuth). */
export function deriveKey(key: Buffer, purpose: string): Buffer {
  return createHmac("sha256", key).update(purpose).digest();
}
