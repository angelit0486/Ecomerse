import { describe, expect, it } from "vitest";

import { applyStoreText, EDITABLE_EMAILS, renderText, STORE_NOTE_MARK } from "./store-texts";

const vars = { nombre: "Ana <b>", pedido: "#1001", tienda: "Tienda X" };
const msg = {
  subject: "Tu pedido #1001 va en camino",
  html: `<body><p>Hola</p>${STORE_NOTE_MARK}<p>Contacto</p></body>`,
  text: "Hola, Ana:\n\nEnviamos tu pedido.\n\nTienda X",
};

describe("textos de la tienda en los correos (paso 20)", () => {
  it("sustituye solo las variables conocidas", () => {
    expect(renderText("{nombre}, tu {pedido} de {tienda} {otra}", vars)).toBe(
      "Ana <b>, tu #1001 de Tienda X {otra}",
    );
  });

  it("sin texto de la tienda, el correo queda igual", () => {
    expect(applyStoreText(msg, null, vars)).toBe(msg);
    expect(applyStoreText(msg, { subject: null, note: null }, vars)).toBe(msg);
  });

  it("cambia el asunto en una sola línea y agrega el mensaje escapado antes del contacto", () => {
    const out = applyStoreText(
      msg,
      { subject: "¡{nombre}, ya salió\n{pedido}!", note: "Gracias {nombre}\n<script>x</script>" },
      vars,
    );
    expect(out.subject).toBe("¡Ana <b>, ya salió #1001!");
    expect(out.html).toBe(
      '<body><p>Hola</p><p style="margin-top:16px;padding:12px;border-left:3px solid #999">Gracias Ana &lt;b&gt;<br>&lt;script&gt;x&lt;/script&gt;</p><p>Contacto</p></body>',
    );
    expect(out.text).toBe(
      "Hola, Ana:\n\nEnviamos tu pedido.\n\nGracias Ana <b>\n<script>x</script>\n\nTienda X",
    );
  });

  it("los asuntos de ejemplo usan solo variables conocidas", () => {
    for (const e of EDITABLE_EMAILS) expect(e.defaultSubject).not.toMatch(/\{(?!pedido\})/);
  });
});
