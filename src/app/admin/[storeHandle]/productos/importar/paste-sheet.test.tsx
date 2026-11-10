// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PasteSheet } from "./paste-sheet";

afterEach(cleanup);

const paste = (text: string) =>
  fireEvent.change(screen.getByLabelText("Filas copiadas de tu hoja"), { target: { value: text } });
const button = () => screen.getByRole("button", { name: "Validar filas" }) as HTMLButtonElement;

describe("pegar filas desde la hoja (plan 2026-11-05, fase C)", () => {
  it("sin nada pegado no se puede validar", () => {
    render(<PasteSheet action="/subir" />);
    expect(button().disabled).toBe(true);
  });

  it("dice cuántos productos entendió y con qué columnas", () => {
    render(<PasteSheet action="/subir" />);
    paste("Producto\tPrecio\tExistencias\nTaza\t199\t10\nPlato\t89\t5");
    expect(screen.getByRole("status").textContent).toContain("Entendimos 2 productos");
    expect(screen.getByRole("status").textContent).toContain("Nombre, Precio, Existencias");
    expect(button().disabled).toBe(false);
  });

  it("avisa las columnas que no usará", () => {
    render(<PasteSheet action="/subir" />);
    paste("Producto\tPrecio\tColor favorito\nTaza\t199\tRojo");
    expect(screen.getByRole("status").textContent).toContain("No usaremos: color favorito");
  });

  it("solo los títulos, sin filas: pide pegar los productos", () => {
    render(<PasteSheet action="/subir" />);
    paste("Producto\tPrecio");
    expect(screen.getByRole("status").textContent).toContain("Pega también las filas de productos");
    expect(button().disabled).toBe(true);
  });

  it("lo que no se puede leer no rompe la pantalla", () => {
    render(<PasteSheet action="/subir" />);
    // Más de 100 columnas no es una hoja de productos.
    paste(`${Array.from({ length: 101 }, (_, i) => `c${i}`).join("\t")}\n1`);
    expect(screen.getByRole("status").textContent).toContain("No pudimos leer lo pegado");
    expect(button().disabled).toBe(true);
  });

  it("una celda que empieza con comillas sin cerrar se lee como texto (revisión 2026-11-06)", () => {
    render(<PasteSheet action="/subir" />);
    paste('Producto\tPrecio\n"Taza\t199\nPlato\t89');
    expect(screen.getByRole("status").textContent).toContain("Entendimos 2 productos");
    expect(button().disabled).toBe(false);
  });

  it("manda el archivo al mismo destino que la subida normal, con su modo", () => {
    render(<PasteSheet action="/admin/t/productos/importar/subir" />);
    const form = screen.getByRole("button", { name: "Validar filas" }).closest("form")!;
    expect(form.getAttribute("action")).toBe("/admin/t/productos/importar/subir");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("enctype")).toBe("multipart/form-data");
    expect(form.querySelector('input[type="file"][name="file"]')).toBeTruthy();
    expect(form.querySelector('select[name="mode"]')).toBeTruthy();
  });
});
