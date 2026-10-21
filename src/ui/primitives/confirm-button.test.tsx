// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./confirm-button";

afterEach(cleanup);

function setup() {
  const submit = vi.fn((e: SubmitEvent) => e.preventDefault());
  render(
    <form onSubmit={(e) => submit(e.nativeEvent as SubmitEvent)} aria-label="Producto">
      <ConfirmButton name="intent" value="delete" question="¿Eliminar «Termo»?">
        Eliminar
      </ConfirmButton>
    </form>,
  );
  return submit;
}

describe("ConfirmButton", () => {
  it("el primer clic pregunta y no envía el formulario", () => {
    const submit = setup();
    const first = screen.getByRole("button", { name: "Eliminar" });
    expect(first.getAttribute("type")).toBe("button");
    fireEvent.click(first);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText("¿Eliminar «Termo»?")).toBeTruthy();
    const yes = screen.getByRole("button", { name: "Sí, eliminar" });
    expect(document.activeElement).toBe(yes);
  });

  it("«Sí» envía con el nombre y el valor del botón", () => {
    const submit = setup();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const yes = screen.getByRole("button", { name: "Sí, eliminar" });
    expect(yes.getAttribute("type")).toBe("submit");
    expect(yes.getAttribute("name")).toBe("intent");
    expect(yes.getAttribute("value")).toBe("delete");
    fireEvent.click(yes);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("«No» y Escape cancelan y devuelven el foco al botón", () => {
    const submit = setup();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.queryByRole("button", { name: "Sí, eliminar" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Eliminar" }));

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Sí, eliminar" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Sí, eliminar" })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("en carga, «Sí» queda deshabilitado (sin doble envío)", () => {
    render(
      <ConfirmButton question="¿Quitar?" loading>
        Quitar
      </ConfirmButton>,
    );
    expect(screen.getByRole("button", { name: "Quitar" }).hasAttribute("disabled")).toBe(true);
  });
});
