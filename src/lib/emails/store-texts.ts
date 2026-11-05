/**
 * Textos de la tienda en los correos del comprador (auditoría global, paso 20).
 * La dueña cambia el asunto y agrega un mensaje con variables fijas; lo
 * esencial del correo no se toca. Todo es texto: se escapa al armar el HTML
 * (regla 13), y las variables desconocidas se dejan tal cual.
 */
export const EDITABLE_EMAILS = [
  {
    key: "order_received",
    label: "Pedido recibido (pago pendiente)",
    defaultSubject: "Recibimos tu pedido {pedido}",
  },
  {
    key: "order_confirmation",
    label: "Pago confirmado",
    defaultSubject: "Confirmamos tu pedido {pedido}",
  },
  {
    key: "order_shipped",
    label: "Pedido enviado",
    defaultSubject: "Tu pedido {pedido} va en camino",
  },
  {
    key: "order_delivered",
    label: "Pedido entregado",
    defaultSubject: "Tu pedido {pedido} fue entregado",
  },
  {
    key: "order_cancelled",
    label: "Pedido cancelado",
    defaultSubject: "Tu pedido {pedido} fue cancelado",
  },
  { key: "refund_issued", label: "Reembolso", defaultSubject: "Reembolso para tu pedido {pedido}" },
] as const;

export type EditableEmail = (typeof EDITABLE_EMAILS)[number]["key"];

export const EDITABLE_KEYS: ReadonlySet<string> = new Set(EDITABLE_EMAILS.map((e) => e.key));

export interface StoreText {
  subject: string | null;
  note: string | null;
}

export interface TextVars {
  nombre: string;
  pedido: string;
  tienda: string;
}

/** Ejemplo para la vista previa del panel. */
export const SAMPLE_VARS: TextVars = { nombre: "Ana Ruiz", pedido: "#1001", tienda: "Tu tienda" };

/** Sustituye {nombre}, {pedido} y {tienda}; lo demás queda igual. */
export function renderText(text: string, vars: TextVars): string {
  return text.replace(/\{(nombre|pedido|tienda)\}/g, (_, k: keyof TextVars) => vars[k]);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Dónde va el mensaje de la tienda dentro del HTML (lo deja `layout`). */
export const STORE_NOTE_MARK = "<!--store-note-->";

interface Message {
  subject: string;
  html: string;
  text: string;
}

/**
 * Aplica el texto de la tienda a un correo ya armado: el asunto se reemplaza
 * (una línea, máximo 150) y el mensaje va después del contenido, antes del
 * contacto, escapado y con sus saltos de línea.
 */
export function applyStoreText<M extends Message>(
  msg: M,
  text: StoreText | null | undefined,
  vars: TextVars,
): M {
  if (!text) return msg;
  const subject = text.subject
    ? renderText(text.subject, vars).replace(/\s+/g, " ").trim().slice(0, 150)
    : "";
  const note = text.note ? renderText(text.note, vars).trim() : "";
  if (!subject && !note) return msg;
  const html = note
    ? // Con función: un texto de reemplazo trataría «$'», «$&» o «$`» como patrones.
      msg.html.replace(
        STORE_NOTE_MARK,
        () =>
          `<p style="margin-top:16px;padding:12px;border-left:3px solid #999">${escapeHtml(note).replace(/\n/g, "<br>")}</p>`,
      )
    : msg.html;
  // En el texto, el mensaje va antes de la firma (el último renglón es la tienda).
  const cut = msg.text.lastIndexOf("\n\n");
  const plain = note
    ? cut >= 0
      ? `${msg.text.slice(0, cut)}\n\n${note}${msg.text.slice(cut)}`
      : `${msg.text}\n\n${note}`
    : msg.text;
  return { ...msg, subject: subject || msg.subject, html, text: plain };
}
