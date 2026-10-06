import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeHtml } from "./safe-html";

describe("SafeHtml", () => {
  it("sanitiza al renderizar aunque lo guardado sea malicioso", () => {
    const markup = renderToStaticMarkup(
      <SafeHtml
        html={'<p>Hola</p><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>'}
      />,
    );
    expect(markup).toBe('<div><p>Hola</p><a rel="nofollow noopener noreferrer ugc">x</a></div>');
  });

  it("no renderiza nada si no queda contenido", () => {
    expect(renderToStaticMarkup(<SafeHtml html="<script>alert(1)</script>" />)).toBe("");
    expect(renderToStaticMarkup(<SafeHtml html={null} />)).toBe("");
  });
});
