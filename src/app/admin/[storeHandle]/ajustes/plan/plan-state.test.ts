import { describe, expect, it, vi } from "vitest";

import {
  canPayOnline,
  loadPaymentOptions,
  PAYMENT_OPTIONS_ERROR_TEXT,
  PLAN_UNAVAILABLE_TEXT,
} from "./plan-state";

describe("textos de Plan y uso", () => {
  it("sin datos del plan no habla de una «actualización» de la plataforma", () => {
    expect(PLAN_UNAVAILABLE_TEXT).toContain("No pudimos cargar tu plan");
    expect(PLAN_UNAVAILABLE_TEXT).not.toContain("actualización");
  });

  it("el aviso de pago es claro y sin detalles internos", () => {
    expect(PAYMENT_OPTIONS_ERROR_TEXT).toBe(
      "No pudimos cargar las opciones de pago. Recarga la página para intentarlo de nuevo.",
    );
  });
});

describe("canPayOnline", () => {
  it("solo la dueña y con Stripe configurado", () => {
    expect(canPayOnline("org_owner", true)).toBe(true);
    expect(canPayOnline("org_owner", false)).toBe(false);
    expect(canPayOnline("org_admin", true)).toBe(false);
    expect(canPayOnline(null, true)).toBe(false);
  });
});

describe("loadPaymentOptions", () => {
  const plan = { key: "pro" };
  const change = { plans: [plan] };

  it("sin permiso (org_admin) no consulta nada ni muestra aviso", async () => {
    const loadPlans = vi.fn(async () => [plan]);
    const loadChange = vi.fn(async () => change);
    const allowed = canPayOnline("org_admin", true);
    const result = await loadPaymentOptions(allowed, loadPlans, loadChange);
    expect(result).toEqual({ plans: [], change: null, failed: false });
    expect(loadPlans).not.toHaveBeenCalled();
    expect(loadChange).not.toHaveBeenCalled();
  });

  it("con las opciones cargadas no hay aviso", async () => {
    const result = await loadPaymentOptions(
      true,
      async () => [plan],
      async () => change,
    );
    expect(result).toEqual({ plans: [plan], change, failed: false });
  });

  it("si falla la lectura de planes se marca el fallo (no una lista vacía silenciosa)", async () => {
    const onError = vi.fn();
    const failure = new Error("rpc failed");
    const result = await loadPaymentOptions(
      true,
      async () => {
        throw failure;
      },
      async () => change,
      onError,
    );
    expect(result.failed).toBe(true);
    expect(result.plans).toEqual([]);
    expect(result.change).toEqual(change);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("si falla la de cambio de plan también se marca el fallo", async () => {
    const result = await loadPaymentOptions(
      true,
      async () => [plan],
      async () => {
        throw new Error("rpc failed");
      },
    );
    expect(result).toEqual({ plans: [plan], change: null, failed: true });
  });
});
