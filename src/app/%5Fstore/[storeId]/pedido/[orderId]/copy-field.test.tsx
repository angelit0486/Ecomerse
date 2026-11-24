import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyField } from "./copy-field";

describe("dato del pago con botón Copiar", () => {
  it("muestra el dato agrupado, copia el valor sin espacios y nombra el botón", () => {
    const html = renderToStaticMarkup(
      <CopyField label="CLABE" value="167041000088400281" display="1670 4100 0088 4002 81" />,
    );
    expect(html).toContain('data-copy-value="167041000088400281"');
    expect(html).toContain(">1670 4100 0088 4002 81</span>");
    expect(html).toContain('aria-label="Copiar CLABE"');
    expect(html).toContain('role="status"');
    // Antes de tocarlo no anuncia nada.
    expect(html).not.toContain("copiada");
  });

  it("la CLABE no se corta a media cifra", () => {
    const html = renderToStaticMarkup(<CopyField label="CLABE" value="1" />);
    expect(html).not.toContain("break-all");
  });
});
