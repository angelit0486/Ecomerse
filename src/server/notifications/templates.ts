import type { EmailMessage } from "./types";

/**
 * Plantillas de plataforma de la Fase 2 (GATE0 §27.2: staff_invitation,
 * support_access_notice). Todo dato variable se escapa: un nombre de tienda u
 * organización nunca puede inyectar HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const dateFormat = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">${bodyHtml}</body></html>`;
}

export function staffInvitationEmail(input: {
  to: string;
  organizationName: string;
  storeName: string | null;
  link: string;
  expiresAt: Date;
}): EmailMessage {
  const where = input.storeName
    ? `la tienda ${input.storeName} (${input.organizationName})`
    : input.organizationName;
  const expires = dateFormat.format(input.expiresAt);
  const subject = `Te invitaron a ${input.storeName ?? input.organizationName}`;
  return {
    to: input.to,
    subject,
    text: [
      `Te invitaron a colaborar en ${where}.`,
      "",
      `Acepta la invitación aquí: ${input.link}`,
      `El enlace caduca el ${expires}. Para entrar necesitarás una app de autenticación (verificación en dos pasos).`,
      "",
      "Si no esperabas esta invitación, ignora este correo.",
    ].join("\n"),
    html: layout(
      subject,
      `<p>Te invitaron a colaborar en <strong>${escapeHtml(where)}</strong>.</p>
<p><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Aceptar invitación</a></p>
<p>El enlace caduca el ${escapeHtml(expires)}. Para entrar necesitarás una app de autenticación (verificación en dos pasos).</p>
<p style="color:#555">Si no esperabas esta invitación, ignora este correo.</p>`,
    ),
  };
}

export function supportAccessNoticeEmail(input: {
  to: string;
  ownerName: string | null;
  storeName: string;
  reason: string;
  minutes: number;
  expiresAt: Date;
  panelLink: string;
}): EmailMessage {
  const greeting = input.ownerName ? `Hola, ${input.ownerName}:` : "Hola:";
  const expires = dateFormat.format(input.expiresAt);
  const subject = `Acceso de soporte a ${input.storeName}`;
  return {
    to: input.to,
    subject,
    text: [
      greeting,
      "",
      `El equipo de soporte de la plataforma tiene acceso de solo lectura a ${input.storeName} durante ${input.minutes} minutos (hasta el ${expires}).`,
      `Motivo: ${input.reason}`,
      "",
      `Puedes revocarlo en cualquier momento desde el panel: ${input.panelLink}`,
    ].join("\n"),
    html: layout(
      subject,
      `<p>${escapeHtml(greeting)}</p>
<p>El equipo de soporte de la plataforma tiene <strong>acceso de solo lectura</strong> a <strong>${escapeHtml(input.storeName)}</strong> durante ${input.minutes} minutos (hasta el ${escapeHtml(expires)}).</p>
<p><strong>Motivo:</strong> ${escapeHtml(input.reason)}</p>
<p>Puedes revocarlo en cualquier momento desde el <a href="${escapeHtml(input.panelLink)}">panel</a>.</p>`,
    ),
  };
}

const AUTH_SUBJECTS: Record<string, string> = {
  signup: "Tu código para entrar",
  magiclink: "Tu código para entrar",
  invite: "Tu código para entrar",
  reauthentication: "Tu código de confirmación",
  recovery: "Tu código para recuperar el acceso",
  email_change: "Confirma tu nuevo email",
};

/**
 * Marca de la tienda en la que el comprador pidió el código (F8-T01, D-F7-07). Sin
 * Reply-To: nadie debe responder (ni reenviar) un código de acceso (Gate F8).
 */
export interface AuthEmailBrand {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

/** Código de un solo uso de Supabase Auth (Send Email Hook, F7-T04b; marca por tienda, F8-T01). */
export function authCodeEmail(input: {
  to: string;
  code: string;
  action: string;
  expiresMinutes: number;
  brand?: AuthEmailBrand | null;
}): EmailMessage {
  const brand = input.brand ?? null;
  const base = AUTH_SUBJECTS[input.action] ?? "Tu código de verificación";
  const subject = brand ? `${base} a ${brand.name}` : base;
  const header = brand
    ? brand.logoUrl?.startsWith("https://")
      ? `<p><img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="48" style="max-height:48px"></p>`
      : `<p style="font-size:20px;font-weight:700">${escapeHtml(brand.name)}</p>`
    : "";
  const color =
    brand?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor)
      ? brand.primaryColor
      : "#1a1a1a";
  return {
    to: input.to,
    subject,
    ...(brand ? { fromName: brand.name } : {}),
    text: [
      `Tu código es: ${input.code}`,
      "",
      `Caduca en ${input.expiresMinutes} minutos. No lo compartas con nadie: nunca te lo pediremos.`,
      "",
      "Si no lo pediste, ignora este correo.",
    ].join("\n"),
    html: layout(
      subject,
      `${header}<p>Tu código es:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;color:${color}">${escapeHtml(input.code)}</p>
<p>Caduca en ${input.expiresMinutes} minutos. No lo compartas con nadie: nunca te lo pediremos.</p>
<p style="color:#555">Si no lo pediste, ignora este correo.</p>`,
    ),
  };
}
