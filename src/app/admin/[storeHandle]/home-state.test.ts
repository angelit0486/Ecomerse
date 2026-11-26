import { describe, expect, it } from "vitest";

import type { LaunchProgress } from "@/lib/onboarding/launch-steps";

import {
  launchCopy,
  needsAttentionText,
  pendingPaymentText,
  pendingReviewsFrom,
  queueWaitingFrom,
} from "./home-state";

const failure = { code: "57014", message: "canceling statement due to statement timeout" };

describe("lista para publicar", () => {
  const progress = (over: Partial<LaunchProgress> = {}): LaunchProgress => ({
    done: 3,
    total: 9,
    percent: 33,
    next: null,
    blocking: 2,
    ...over,
  });

  it("si la consulta falla no dice «Ya tiene todo lo necesario»", () => {
    const copy = launchCopy("error");
    expect(copy.message).toBe("No pudimos revisar qué le falta.");
    expect(copy.cta).toBe("Revisar configuración");
    expect(copy.message).not.toContain("todo lo necesario");
    expect(copy.cta).not.toBe("Publicar mi tienda");
  });

  it("sin pendientes necesarios sí invita a publicar", () => {
    expect(launchCopy(progress({ blocking: 0, done: 7 }))).toEqual({
      message: "Ya tiene todo lo necesario para publicar. Llevas 7 de 9 pasos.",
      cta: "Publicar mi tienda",
      next: null,
    });
  });

  it("cuenta lo mismo que la guía y dice cuál sigue", () => {
    const next = { title: "Pagos" } as LaunchProgress["next"];
    expect(launchCopy(progress({ next }))).toEqual({
      message: "Le faltan 2 pasos necesarios para publicar. Llevas 3 de 9 pasos.",
      cta: "Terminar de configurar",
      next: "Pagos",
    });
    expect(launchCopy(progress({ blocking: 1 })).message).toContain(
      "Le falta 1 paso necesario para publicar.",
    );
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

describe("contadores de «Por atender»", () => {
  it("singular con uno, plural con cero o varios", () => {
    expect(pendingPaymentText(1)).toBe("1 pendiente de pago");
    expect(pendingPaymentText(0)).toBe("0 pendientes de pago");
    expect(pendingPaymentText(3)).toBe("3 pendientes de pago");
    expect(needsAttentionText(1)).toBe("1 necesita atención");
    expect(needsAttentionText(2)).toBe("2 necesitan atención");
  });
});
