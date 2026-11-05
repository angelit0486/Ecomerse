// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ saveThemeSection: vi.fn(async () => ({})) }));

import { PersonalityForm } from "./personality-form";

afterEach(cleanup);

const value = (label: string) => (screen.getByLabelText(label) as HTMLSelectElement).value;

describe("Apariencia → Personalidad", () => {
  it("muestra lo guardado y, sin nada guardado, «como hoy»", () => {
    render(
      <PersonalityForm
        storeHandle="demo"
        revision={3}
        personality={{ card_style: "flat", heading_case: "uppercase" }}
      />,
    );
    expect(value("Estilo de las tarjetas de producto")).toBe("flat");
    expect(value("Mayúsculas en los títulos")).toBe("uppercase");
    expect(value("Forma de la foto")).toBe("1:1");
    expect(value("Grosor de los títulos")).toBe("");
    expect(value("Movimiento")).toBe("none");
    expect(
      (screen.getByRole("button", { name: "Guardar en el borrador" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("la vista rápida sigue lo que se elige", () => {
    render(<PersonalityForm storeHandle="demo" revision={1} personality={{}} />);
    const sample = screen.getByText("Lo más nuevo");
    expect(sample.className).not.toContain("uppercase");
    fireEvent.change(screen.getByLabelText("Mayúsculas en los títulos"), {
      target: { value: "uppercase" },
    });
    expect(sample.className).toContain("uppercase");
    fireEvent.change(screen.getByLabelText("Forma de la foto"), { target: { value: "3:4" } });
    expect(screen.getByText("Foto").parentElement!.className).toContain("aspect-[3/4]");
  });
});
