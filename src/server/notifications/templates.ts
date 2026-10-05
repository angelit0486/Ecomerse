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
