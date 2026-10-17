import { describe, expect, it } from "vitest";

import { axisValueLabel, paymentAttemptLabel, paymentProviderLabel } from "./axis-labels";

describe("etiquetas de los ejes del pedido", () => {
  it("traduce los códigos internos", () => {
    expect(axisValueLabel("pending_payment")).toBe("Pendiente de pago");
    expect(axisValueLabel("paid")).toBe("Pagado");
    expect(axisValueLabel("partially_fulfilled")).toBe("Enviado parcialmente");
  });

  it("sin valor, un guion; desconocido, tal cual", () => {
    expect(axisValueLabel(null)).toBe("—");
    expect(axisValueLabel("nuevo_estado")).toBe("nuevo_estado");
  });

  it("intentos de pago en español", () => {
    expect(paymentProviderLabel("manual")).toBe("Pago manual");
    expect(paymentAttemptLabel("succeeded")).toBe("Cobrado");
    expect(paymentAttemptLabel("otro")).toBe("otro");
  });
});
