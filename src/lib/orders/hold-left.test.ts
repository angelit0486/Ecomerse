import { describe, expect, it } from "vitest";

import { holdLeftLabel } from "./hold-left";

describe("holdLeftLabel", () => {
  it("dice minutos mientras falte menos de una hora", () => {
    expect(holdLeftLabel(0)).toBe("menos de un minuto");
    expect(holdLeftLabel(1)).toBe("1 minuto");
    expect(holdLeftLabel(28)).toBe("28 minutos");
    expect(holdLeftLabel(59)).toBe("59 minutos");
  });

  it("dice horas completas desde una hora (transferencia: 24 horas)", () => {
    expect(holdLeftLabel(60)).toBe("1 hora");
    expect(holdLeftLabel(119)).toBe("1 hora");
    expect(holdLeftLabel(1438)).toBe("23 horas");
    expect(holdLeftLabel(1440)).toBe("24 horas");
  });
});
