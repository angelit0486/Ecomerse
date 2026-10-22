import { describe, expect, it } from "vitest";

import { localInputNow } from "./local-input";

describe("hora de la tienda para datetime-local", () => {
  it("convierte a la zona de la tienda, con 24 horas", () => {
    const at = new Date("2026-10-21T23:05:00Z");
    expect(localInputNow("America/Mazatlan", at)).toBe("2026-10-21T16:05");
    expect(localInputNow("America/Mexico_City", at)).toBe("2026-10-21T17:05");
  });

  it("medianoche es 00, no 24", () => {
    expect(localInputNow("UTC", new Date("2026-10-22T00:00:00Z"))).toBe("2026-10-22T00:00");
  });
});
