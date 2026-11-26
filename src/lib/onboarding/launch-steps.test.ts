import { describe, expect, it } from "vitest";

import { launchProgress, launchSteps, launchSummary, type LaunchInput } from "./launch-steps";

const issue = (code: string) => ({ code, message: code });

/** Tienda recién creada: nada hecho. */
function fresh(over: Partial<LaunchInput> = {}): LaunchInput {
  return {
    issues: [
      issue("payment_method"),
      issue("active_product"),
      issue("policy_privacy"),
      issue("policy_terms"),
      issue("policy_returns"),
      issue("contact"),
    ],
    launched: false,
    brandingSaved: false,
    hasLogo: false,
    sampleCount: 0,
    shippingZones: 0,
    taxRateBps: 0,
    pricesIncludeTax: true,
    currency: "MXN",
    customDomain: false,
    base: "/admin/t",
    ...over,
  };
}

const keys = (input: LaunchInput) => launchSteps(input).map((s) => s.key);
const step = (input: LaunchInput, key: string) => launchSteps(input).find((s) => s.key === key)!;

describe("pasos de «Lanza tu tienda»", () => {
  it("una tienda nueva: 9 pasos en orden, ninguno listo y el primero necesario es el siguiente", () => {
    expect(keys(fresh())).toEqual([
      "template",
      "profile",
      "logo",
      "products",
      "payments",
      "shipping",
      "taxes",
      "policies",
      "publish",
      "domain",
    ]);
    const p = launchProgress(launchSteps(fresh()));
    expect(p).toMatchObject({ done: 0, total: 9, percent: 0 });
    expect(p.next?.key).toBe("profile");
    // Datos, productos, pagos y políticas (envíos aún no: no hay productos físicos).
    expect(p.blocking).toBe(4);
  });

  it("envíos no cuenta como listo sin una zona real, aunque la base aún no lo exija", () => {
    // Sin productos físicos la base no pide envíos: antes salía «✓ Listo».
    expect(step(fresh(), "shipping")).toMatchObject({ done: false, required: false });
    // Con productos que se envían, la base lo exige y pasa a necesario.
    expect(step(fresh({ issues: [issue("shipping_zone")] }), "shipping").required).toBe(true);
    expect(step(fresh({ shippingZones: 1 }), "shipping").done).toBe(true);
    expect(
      step(fresh({ shippingZones: 1, issues: [issue("shipping_zone")] }), "shipping").done,
    ).toBe(false);
  });

  it("productos de ejemplo: el paso dice cuántos quitar y lleva a la plantilla", () => {
    const s = step(fresh({ sampleCount: 4, issues: [issue("sample_products")] }), "products");
    expect(s.done).toBe(false);
    expect(s.detail).toBe("Quita los 4 de ejemplo y sube los tuyos");
    expect(s.href).toBe("#paso-plantilla");
  });

  it("cumplimiento sanitario aparece solo cuando la base lo pide", () => {
    expect(keys(fresh())).not.toContain("compliance");
    const input = fresh({ issues: [issue("compliance_profile")] });
    expect(step(input, "compliance")).toMatchObject({ required: true, done: false });
  });

  it("con todo lo necesario: el siguiente es lo recomendado y luego publicar", () => {
    const ready = fresh({ issues: [], shippingZones: 1 });
    const p = launchProgress(launchSteps(ready));
    expect(p.blocking).toBe(0);
    expect(p.next?.key).toBe("template");
    expect(launchSummary(p)).toBe("Ya tiene todo lo necesario para publicar.");
    const polished = fresh({
      issues: [],
      shippingZones: 1,
      brandingSaved: true,
      hasLogo: true,
      taxRateBps: 1600,
    });
    expect(launchProgress(launchSteps(polished)).next?.key).toBe("publish");
  });

  it("publicada: el dominio propio queda como sugerencia y no cambia el avance", () => {
    const live = fresh({
      issues: [],
      shippingZones: 1,
      brandingSaved: true,
      hasLogo: true,
      taxRateBps: 1600,
      launched: true,
    });
    const p = launchProgress(launchSteps(live));
    expect(p).toMatchObject({ done: 9, total: 9, percent: 100 });
    expect(p.next?.key).toBe("domain");
    expect(launchProgress(launchSteps({ ...live, customDomain: true })).next).toBeNull();
  });

  it("el porcentaje nunca dice 100 con algo pendiente", () => {
    const almost = fresh({
      issues: [],
      shippingZones: 1,
      brandingSaved: true,
      hasLogo: true,
      taxRateBps: 1600,
    });
    expect(launchProgress(launchSteps(almost)).percent).toBe(88);
  });

  it("la tarjeta del Inicio cuenta lo mismo que la guía", () => {
    expect(launchSummary(launchProgress(launchSteps(fresh())))).toBe(
      "Le faltan 4 pasos necesarios para publicar.",
    );
    const one = fresh({ issues: [issue("payment_method")], shippingZones: 1 });
    expect(launchSummary(launchProgress(launchSteps(one)))).toBe(
      "Le falta 1 paso necesario para publicar.",
    );
  });
});
