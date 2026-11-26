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

const { cachedRead, invalidateCompliance, invalidateStore, storeTag, withConnectionRetry } =
  await import("./cache");

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

/**
 * Registros de producción (2026-11-22 a 26): lecturas de milisegundos fallaban
 * con `CONNECT_TIMEOUT` al conectar con el pooler; la caché seguía mostrando la
 * copia vieja (precio que «tardaba») o salía la página de error.
 */
describe("withConnectionRetry", () => {
  const failWith = (code: string) => Object.assign(new Error(`write ${code}`), { code });

  beforeEach(() => warn.mockReset());

  it("si la conexión no entra, reintenta una vez y devuelve el dato", async () => {
    const read = vi.fn().mockRejectedValueOnce(failWith("CONNECT_TIMEOUT")).mockResolvedValue("ok");
    await expect(withConnectionRetry("card_variants", read)).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("storefront.read_retry", {
      read: "card_variants",
      code: "CONNECT_TIMEOUT",
    });
  });

  it("un error de la consulta (statement timeout) no se repite: duplicaría la carga", async () => {
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    const read = vi.fn().mockRejectedValue(timeout);
    await expect(withConnectionRetry("card_variants", read)).rejects.toBe(timeout);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("solo un reintento: si la segunda conexión tampoco entra, el error sube", async () => {
    const read = vi.fn().mockRejectedValue(failWith("CONNECT_TIMEOUT"));
    await expect(withConnectionRetry("list_products", read)).rejects.toMatchObject({
      code: "CONNECT_TIMEOUT",
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("las lecturas en caché usan el reintento", async () => {
    const read = vi.fn().mockRejectedValueOnce(failWith("ECONNRESET")).mockResolvedValue(42);
    const cached = cachedRead("get_store_public", read);
    await expect(cached("tienda-1")).resolves.toBe(42);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
