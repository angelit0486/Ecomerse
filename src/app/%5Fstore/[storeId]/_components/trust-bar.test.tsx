import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { lookCss } from "@/lib/theme/looks";

import { TrustBar } from "./trust-bar";

describe("detalles: el teléfono y el buscador no se cortan", () => {
  it("el número de WhatsApp va en un solo renglón (nunca «+52 662 123 / 4567»)", () => {
    const html = renderToStaticMarkup(
      <TrustBar
        shipping={null}
        payments={[]}
        whatsapp="+526621234567"
        store={{ currency: "MXN", locale: "es-MX", country: "MX" }}
      />,
    );
    expect(html).toMatch(/WhatsApp <span class="whitespace-nowrap">\+52 662 123 4567<\/span>/);
  });

  it("con el look, el texto largo del buscador termina en «…» y el toque no destella en gris", () => {
    const css = lookCss("nocturno");
    expect(css).toContain("form[role=search] input{text-overflow:ellipsis}");
    expect(css).toContain("-webkit-tap-highlight-color:color-mix(");
  });
});
