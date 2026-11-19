import { describe, expect, it } from "vitest";

import { ALIEN_DEMON_CUTOFF, countdownLabel, deliveryCutoff } from "./delivery-cutoff";

// Hermosillo = UTC−7 todo el año: 16:20 locales = 23:20 UTC.
const at = (iso: string) => deliveryCutoff(new Date(iso), ALIEN_DEMON_CUTOFF);

describe("hora de corte de envío (4:20 pm, Hermosillo, lunes a viernes)", () => {
  it("lunes antes del corte: llega mañana y cuenta lo que falta", () => {
    const s = at("2026-11-16T21:00:00Z"); // lunes 14:00
    expect(s).toEqual({
      beforeCutoff: true,
      msLeft: (2 * 3600 + 20 * 60) * 1000,
      arrival: "mañana",
    });
  });

  it("lunes después del corte: sale el martes y llega el miércoles", () => {
    expect(at("2026-11-17T00:30:00Z")).toEqual({
      beforeCutoff: false,
      msLeft: 0,
      arrival: "el miércoles",
    });
  });

  it("justo a las 4:20 pm ya no alcanza", () => {
    expect(at("2026-11-16T23:20:00Z").beforeCutoff).toBe(false);
    expect(at("2026-11-16T23:19:59Z").beforeCutoff).toBe(true);
  });

  it("jueves después del corte: sale el viernes y llega el lunes", () => {
    expect(at("2026-11-20T01:00:00Z").arrival).toBe("el lunes"); // jueves 18:00
  });

  it("viernes antes del corte: no hay entregas el fin de semana, llega el lunes", () => {
    expect(at("2026-11-20T17:00:00Z")).toMatchObject({ beforeCutoff: true, arrival: "el lunes" });
  });

  it("viernes después del corte, sábado y domingo: sale el lunes y llega el martes", () => {
    expect(at("2026-11-21T00:00:00Z")).toMatchObject({ beforeCutoff: false, arrival: "el martes" });
    expect(at("2026-11-21T18:00:00Z")).toMatchObject({ beforeCutoff: false, arrival: "el martes" });
    expect(at("2026-11-22T18:00:00Z")).toMatchObject({ beforeCutoff: false, arrival: "el martes" });
  });

  it("usa la hora de Hermosillo, no la del servidor (UTC)", () => {
    // 2026-11-17 02:00 UTC = lunes 19:00 en Hermosillo (ya pasó el corte), aunque en UTC sea martes.
    expect(at("2026-11-17T02:00:00Z")).toMatchObject({
      beforeCutoff: false,
      arrival: "el miércoles",
    });
  });

  it("formato de la cuenta regresiva", () => {
    expect(countdownLabel((2 * 3600 + 5 * 60 + 9) * 1000)).toBe("2:05:09");
    expect(countdownLabel((45 * 60 + 9) * 1000)).toBe("45:09");
    expect(countdownLabel(-5)).toBe("0:00");
  });
});
