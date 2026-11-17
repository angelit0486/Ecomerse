// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CartView } from "@/server/storefront/cart";

vi.mock("../carrito/actions", () => ({ checkout: async () => ({}) }));

const { CheckoutForm } = await import("./checkout-form");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STANDARD = "0190a7e2-1c3d-7a4b-8c5d-6e7f80910a01";
const PICKUP = "0190a7e2-1c3d-7a4b-8c5d-6e7f80910a02";

const cart = {
  cart_id: "c1",
  currency: "MXN",
  prices_include_tax: true,
  email: "ana@example.io",
  shipping_address: {
    recipient_name: "Ana",
    line1: "Calle 1",
    line2: null,
    city: "Puebla",
    region: "Puebla",
    postal_code: "72000",
    country: "MX",
    phone: null,
  },
  lines: [],
  item_count: 1,
  requires_shipping: true,
  discount: null,
  discount_code: null,
  shipping: { status: "ok", rate_id: STANDARD, name: "Estándar", price: 9900 },
  shipping_options: [
    { rate_id: STANDARD, name: "Estándar", type: "flat", price: 9900 },
    { rate_id: PICKUP, name: "Recoger en tienda", type: "pickup", price: 0 },
  ],
  shipping_rate_id: STANDARD,
  subtotal: 49900,
  discount_total: 0,
  shipping_total: 9900,
  tax_total: 0,
  total: 59800,
  has_unavailable: false,
  has_insufficient_stock: false,
} as unknown as CartView;

describe("checkout: elegir otra forma de envío", () => {
  it("envía al momento la intención «rate» con la tarifa elegida (la base recalcula el total)", () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    render(
      <CheckoutForm
        storeId="s1"
        storeCountry="MX"
        cart={cart}
        methods={[
          { id: "m1", provider: "manual", display_name: "Transferencia", instructions: null },
        ]}
        idempotencyKey="k"
        shippingLabels={{ [STANDARD]: "$99.00", [PICKUP]: "Gratis" }}
        totalLabel="$598.00"
        pickup={{ address: "Av. Juárez 10", hours: null }}
      />,
    );
    const pickup = screen.getByRole("radio", { name: /Recoger en tienda/ });
    fireEvent.click(pickup);
    expect(requestSubmit).toHaveBeenCalledOnce();
    const submitter = requestSubmit.mock.calls[0]![0] as HTMLButtonElement;
    expect(submitter.name).toBe("intent");
    expect(submitter.value).toBe("rate");
    const data = new FormData(submitter.form!, submitter);
    expect(data.get("shipping_rate_id")).toBe(PICKUP);
    expect(data.get("intent")).toBe("rate");
  });

  it("el botón oculto no es alcanzable con el teclado ni para lectores de pantalla", () => {
    const { container } = render(
      <CheckoutForm
        storeId="s1"
        storeCountry="MX"
        cart={cart}
        methods={[]}
        idempotencyKey="k"
        shippingLabels={{}}
        totalLabel="$598.00"
      />,
    );
    const rate = container.querySelector<HTMLButtonElement>('button[value="rate"]')!;
    expect(rate.hidden).toBe(true);
    expect(rate.tabIndex).toBe(-1);
    expect(rate.getAttribute("aria-hidden")).toBe("true");
  });
});
