// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { Field } from "./field";
import { Input } from "./input";
import { Skeleton } from "./skeleton";

afterEach(cleanup);

describe("Button", () => {
  it("es type=button por defecto (no envía formularios por accidente)", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button", { name: "Guardar" }).getAttribute("type")).toBe("button");
  });

  it("en carga se deshabilita y se anuncia con aria-busy", () => {
    render(<Button loading>Guardando</Button>);
    const button = screen.getByRole("button", { name: "Guardando" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });
});

describe("Field + Input", () => {
  it("asocia etiqueta, ayuda y error al control", () => {
    render(
      <Field
        label="Correo"
        hint="Lo usamos para avisos."
        error="Escribe un correo válido."
        required
      >
        {(control) => <Input type="email" {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Correo/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.hasAttribute("required")).toBe(true);
    const describedBy = input.getAttribute("aria-describedby")!.split(" ");
    const texts = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(["Lo usamos para avisos.", "Escribe un correo válido."]);
  });

  it("sin error no marca aria-invalid ni referencia ids inexistentes", () => {
    render(<Field label="Nombre">{(control) => <Input {...control} />}</Field>);
    const input = screen.getByLabelText("Nombre");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("EmptyState y Skeleton", () => {
  it("EmptyState es una región con título accesible", () => {
    render(<EmptyState title="Sin pedidos" description="Aún no recibes pedidos." />);
    expect(screen.getByRole("region", { name: "Sin pedidos" })).toBeTruthy();
  });

  it("Skeleton está oculto para lectores de pantalla", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
