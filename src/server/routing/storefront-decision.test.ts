import { describe, expect, it } from "vitest";

import { decideStorefront, type DecideInput, type HostResolution } from "./storefront-decision";

const STORE = "0190a0d0-0000-7000-8000-00000000000a";
const OTHER = "0190a0d0-0000-7000-8000-00000000000b";

const resolution = (patch: Partial<HostResolution> = {}): HostResolution => ({
  storeId: STORE,
  status: "active",
  primaryHostname: "tienda-a.tiendas.test",
  isPrimary: true,
  ...patch,
});

const input = (patch: Partial<DecideInput> = {}): DecideInput => ({
  host: "tienda-a.tiendas.test",
  pathname: "/productos",
  search: "?orden=precio",
  protocol: "https",
  resolution: resolution(),
  previewStoreId: null,
  ...patch,
});

describe("decideStorefront", () => {
  it("tienda activa: reescritura interna con el store_id resuelto", () => {
    expect(decideStorefront(input())).toEqual({
      type: "rewrite",
      pathname: `/_store/${STORE}/productos`,
      preview: false,
    });
    expect(decideStorefront(input({ pathname: "/" }))).toMatchObject({
      pathname: `/_store/${STORE}`,
    });
  });

  it("inexistente y cerrada responden igual (404)", () => {
    expect(decideStorefront(input({ resolution: null }))).toEqual({ type: "not_found" });
    expect(decideStorefront(input({ resolution: resolution({ status: "closed" }) }))).toEqual({
      type: "not_found",
    });
  });

  it("pausada o suspendida: no disponible (503)", () => {
    for (const status of ["paused", "suspended"] as const) {
      expect(decideStorefront(input({ resolution: resolution({ status }) }))).toEqual({
        type: "unavailable",
      });
    }
  });

  it("borrador: 404 sin vista previa; visible con la vista previa de ESA tienda", () => {
    const draft = resolution({ status: "draft" });
    expect(decideStorefront(input({ resolution: draft }))).toEqual({ type: "not_found" });
    expect(decideStorefront(input({ resolution: draft, previewStoreId: OTHER }))).toEqual({
      type: "not_found",
    });
    expect(decideStorefront(input({ resolution: draft, previewStoreId: STORE }))).toMatchObject({
      type: "rewrite",
      preview: true,
    });
  });

  it("borrador: /_preview pasa para poder canjear el token", () => {
    const draft = resolution({ status: "draft" });
    expect(decideStorefront(input({ resolution: draft, pathname: "/_preview" }))).toMatchObject({
      type: "rewrite",
    });
  });

  it("host no primario: 301 al primario conservando ruta y query", () => {
    const decision = decideStorefront(
      input({ host: "www.mitienda.mx", resolution: resolution({ isPrimary: false }) }),
    );
    expect(decision).toEqual({
      type: "redirect",
      location: "https://tienda-a.tiendas.test/productos?orden=precio",
    });
  });

  it("no primario sin primario activo: se sirve sin redirigir", () => {
    expect(
      decideStorefront(
        input({ resolution: resolution({ isPrimary: false, primaryHostname: null }) }),
      ),
    ).toMatchObject({ type: "rewrite" });
  });
});
