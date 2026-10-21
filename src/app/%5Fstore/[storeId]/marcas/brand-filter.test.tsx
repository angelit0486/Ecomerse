// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrandFilter, brandInitials } from "./brand-filter";

afterEach(cleanup);

describe("brandInitials", () => {
  it("toma hasta dos iniciales, con acentos y números", () => {
    expect(brandInitials("Muha Meds")).toBe("MM");
    expect(brandInitials("ELFTHC")).toBe("E");
    expect(brandInitials("óptima nutrición pro")).toBe("ÓN");
    expect(brandInitials("3D Labs")).toBe("3L");
    expect(brandInitials("—")).toBe("?");
  });
});

describe("BrandFilter", () => {
  const brands = [
    { slug: "ace", name: "Ace Ultra", count: 2, logo: null },
    { slug: "besos", name: "Besos", count: 1, logo: { src: "/l.png", width: 64, height: 64 } },
  ];

  it("el buscador tiene texto de ayuda y filtra; sin logo se ven las iniciales", () => {
    render(<BrandFilter brands={brands} searchable />);
    const search = screen.getByLabelText("Buscar marca");
    expect(search.getAttribute("placeholder")).toBe("Escribe el nombre de una marca");
    expect(screen.getByText("AU")).toBeTruthy();
    fireEvent.change(search, { target: { value: "bes" } });
    expect(screen.queryByText("Ace Ultra")).toBeNull();
    expect(screen.getByText("Besos")).toBeTruthy();
  });
});
