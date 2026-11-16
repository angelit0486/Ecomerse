import { describe, expect, it } from "vitest";

import { launchCopy, launchPendingFrom, pendingReviewsFrom, queueWaitingFrom } from "./home-state";

const failure = { code: "57014", message: "canceling statement due to statement timeout" };

describe("lista para publicar", () => {
  it("si la consulta falla no dice «Ya tiene todo lo necesario»", () => {
    const pending = launchPendingFrom({ data: null, error: failure });
    expect(pending).toBe("error");
    const copy = launchCopy(pending);
    expect(copy.message).toBe("No pudimos revisar qué le falta.");
    expect(copy.cta).toBe("Revisar configuración");
    expect(copy.message).not.toContain("todo lo necesario");
    expect(copy.cta).not.toBe("Publicar mi tienda");
  });

  it("sin pendientes reales sí invita a publicar", () => {
    const pending = launchPendingFrom({ data: { issues: [] }, error: null });
    expect(pending).toBe(0);
    expect(launchCopy(pending)).toEqual({
      message: "Ya tiene todo lo necesario.",
      cta: "Publicar mi tienda",
    });
  });

  it("cuenta los pasos que faltan", () => {
    expect(launchPendingFrom({ data: { issues: [{}, {}] }, error: null })).toBe(2);
    expect(launchCopy(1).message).toBe("Le falta 1 paso.");
    expect(launchCopy(3)).toEqual({
      message: "Le faltan 3 pasos.",
      cta: "Terminar de configurar",
    });
  });
});

describe("trabajos en espera", () => {
  const zero = { count: 0, error: null };

  it("si falla el conteo de fotos o de importaciones es un error, no un cero", () => {
    expect(queueWaitingFrom({ count: null, error: failure }, zero)).toBe("error");
    expect(queueWaitingFrom(zero, { count: null, error: failure })).toBe("error");
  });

  it("ceros reales son ceros", () => {
    expect(queueWaitingFrom(zero, zero)).toEqual({ photos: 0, imports: 0 });
    expect(queueWaitingFrom({ count: 4, error: null }, { count: 1, error: null })).toEqual({
      photos: 4,
      imports: 1,
    });
  });
});

describe("opiniones por revisar", () => {
  it("si la consulta falla queda null (no 0)", () => {
    expect(pendingReviewsFrom({ count: null, error: failure })).toBeNull();
  });

  it("sin error devuelve el conteo", () => {
    expect(pendingReviewsFrom({ count: 3, error: null })).toBe(3);
    expect(pendingReviewsFrom({ count: 0, error: null })).toBe(0);
  });
});
