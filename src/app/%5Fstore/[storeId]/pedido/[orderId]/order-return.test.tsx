// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ReturnOptions } from "@/server/storefront/returns";

import { OrderReturn } from "./order-return";

afterEach(cleanup);

const action = async () => ({});
const base: ReturnOptions = {
  deadline: "2026-12-05T00:00:00Z",
  window_closed: false,
  open: false,
  window_days: 30,
  last: null,
  lines: [],
};

describe("devoluciones en la página del pedido (revisión 2026-11-05)", () => {
  it("con plazo vigente y nada por devolver no dice que el plazo terminó", () => {
    render(
      <OrderReturn
        options={base}
        action={action}
        deadlineLabel="5 de diciembre de 2026"
        windowClosed={false}
      />,
    );
    expect(screen.queryByText(/terminó/)).toBeNull();
  });

  it("con el plazo vencido sí lo dice, con su fecha", () => {
    render(
      <OrderReturn
        options={base}
        action={action}
        deadlineLabel="5 de diciembre de 2026"
        windowClosed
      />,
    );
    expect(
      screen.getByText("El plazo para pedir una devolución terminó el 5 de diciembre de 2026."),
    ).toBeTruthy();
  });

  it("dentro del plazo y con unidades, muestra el formulario", () => {
    render(
      <OrderReturn
        options={{
          ...base,
          open: true,
          lines: [{ order_item_id: "i1", title: "Taza", variant: null, available: 2 }],
        }}
        action={action}
        deadlineLabel="5 de diciembre de 2026"
        windowClosed={false}
      />,
    );
    expect(screen.getByRole("form", { name: "Pedir una devolución" })).toBeTruthy();
  });
});
