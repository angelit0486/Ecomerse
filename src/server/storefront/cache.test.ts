import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
  unstable_cache: (read: unknown) => read,
}));

const warn = vi.fn();
vi.mock("@/server/observability/logger", () => ({
  log: { warn: (...a: unknown[]) => warn(...a) },
}));

const { invalidateCompliance, invalidateStore, storeTag } = await import("./cache");

/**
 * Hallazgo del ensayo (Orden 10, mensaje 4): la cola corre también después de
 * responder una acción del panel. En ese momento Next puede negarse a invalidar
 * la caché («can't be called during render»), y el trabajo, que ya había
 * terminado, se marcaba como fallido y se repetía un minuto después.
 */
describe("invalidateStore", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
    warn.mockReset();
  });

  it("invalida la etiqueta de la tienda", () => {
    invalidateStore("tienda-1");
    expect(revalidateTag).toHaveBeenCalledWith(storeTag("tienda-1"), { expire: 0 });
  });

  it("si Next no deja invalidar, no tumba el trabajo: avisa y sigue (el TTL de 60 s es la red)", () => {
    revalidateTag.mockImplementation(() => {
      throw new Error(
        'Route "/admin/[storeHandle]/configuracion": `revalidateTag` can\'t be called during render.',
      );
    });
    expect(() => invalidateStore("tienda-1")).not.toThrow();
    expect(() => invalidateCompliance()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "storefront.cache_invalidation_skipped",
      expect.objectContaining({ tag: storeTag("tienda-1") }),
    );
  });
});
