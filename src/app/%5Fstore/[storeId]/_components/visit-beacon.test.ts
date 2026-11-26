import { describe, expect, it } from "vitest";

import { visitDue } from "./visit-beacon";

describe("aviso de visita: una vez al día por persona", () => {
  it("avisa la primera vez del día y no vuelve a avisar ese mismo día", () => {
    expect(visitDue(null, "2026-11-26", false)).toBe(true);
    expect(visitDue("2026-11-26", "2026-11-26", false)).toBe(false);
    expect(visitDue("2026-11-25", "2026-11-26", false)).toBe(true);
  });

  it("un navegador automatizado nunca avisa (aunque su user-agent parezca de persona)", () => {
    expect(visitDue(null, "2026-11-26", true)).toBe(false);
  });
});
