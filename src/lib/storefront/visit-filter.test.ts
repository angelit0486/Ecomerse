import { describe, expect, it } from "vitest";

import { shouldCountVisit } from "./visit-filter";

const CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const base = { userAgent: CHROME, secFetchSite: "same-origin", preview: false };

describe("qué avisos de visita cuentan", () => {
  it("una persona en su celular, desde la propia tienda, cuenta", () => {
    expect(shouldCountVisit(base)).toBe(true);
    // Navegadores viejos no mandan sec-fetch-site: también cuentan.
    expect(shouldCountVisit({ ...base, secFetchSite: null })).toBe(true);
  });

  it("robots, vistas previas de enlaces y navegadores automáticos no cuentan", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "WhatsApp/2.23.20.0",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
      "curl/8.4.0",
      "",
    ]) {
      expect(shouldCountVisit({ ...base, userAgent: ua })).toBe(false);
    }
    expect(shouldCountVisit({ ...base, userAgent: null })).toBe(false);
  });

  it("un aviso desde otro sitio o en la vista previa del panel no cuenta", () => {
    expect(shouldCountVisit({ ...base, secFetchSite: "cross-site" })).toBe(false);
    expect(shouldCountVisit({ ...base, preview: true })).toBe(false);
  });
});
