// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResults } from "./search-actions";

const searchPanel = vi.fn<(storeHandle: string, q: string) => Promise<SearchResults | null>>();

vi.mock("./search-actions", () => ({
  searchPanel: (h: string, q: string) => searchPanel(h, q),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { GlobalSearch } = await import("./global-search");

const EMPTY: SearchResults = { products: [], orders: [], customers: [] };

beforeEach(() => {
  searchPanel.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Pasa el retardo de 250 ms y deja resolver la cadena `.catch().then()` de la búsqueda. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  await act(async () => {});
}

/** Escribe y espera a que la búsqueda termine. */
async function search(text: string) {
  render(<GlobalSearch storeHandle="mi-tienda" />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });
  await settle();
}

const status = () => document.querySelector("[aria-live]")?.textContent ?? "";

describe("GlobalSearch", () => {
  it("espera el retardo antes de buscar", async () => {
    searchPanel.mockResolvedValue(EMPTY);
    render(<GlobalSearch storeHandle="mi-tienda" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "termo" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(searchPanel).not.toHaveBeenCalled();
    expect(status()).toBe("Buscando…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(searchPanel).toHaveBeenCalledWith("mi-tienda", "termo");
  });

  it("si la acción rechaza (sin red) lo dice y no se queda en «Buscando…»", async () => {
    searchPanel.mockRejectedValue(new Error("Failed to fetch"));
    await search("termo");
    expect(status()).toContain("No pudimos buscar ahora");
    expect(status()).not.toContain("Buscando");
  });

  it("si el servidor falló (null) no muestra «Sin resultados»", async () => {
    searchPanel.mockResolvedValue(null);
    await search("termo");
    expect(status()).toContain("No pudimos buscar ahora");
    expect(status()).not.toContain("Sin resultados");
  });

  it("sin coincidencias reales dice «Sin resultados»", async () => {
    searchPanel.mockResolvedValue(EMPTY);
    await search("termo");
    expect(status()).toContain("Sin resultados");
  });

  it("con un producto muestra el conteo y el enlace", async () => {
    searchPanel.mockResolvedValue({
      ...EMPTY,
      products: [{ href: "/admin/mi-tienda/productos/p1", label: "Termo", detail: "Producto" }],
    });
    await search("termo");
    expect(status()).toBe("1 resultado");
    expect(screen.getByRole("link", { name: /Termo/ }).getAttribute("href")).toBe(
      "/admin/mi-tienda/productos/p1",
    );
  });

  it("tras un fallo, la siguiente búsqueda correcta quita el aviso", async () => {
    searchPanel.mockResolvedValueOnce(null).mockResolvedValueOnce(EMPTY);
    await search("termo");
    expect(status()).toContain("No pudimos buscar ahora");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "termos" } });
    await settle();
    expect(status()).toContain("Sin resultados");
  });
});
