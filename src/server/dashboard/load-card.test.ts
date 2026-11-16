import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
vi.mock("@/server/observability/logger", () => ({ log: { warn } }));

const { loadCard } = await import("./load-card");

describe("loadCard (tarjetas de Inicio)", () => {
  beforeEach(() => warn.mockReset());

  it("dato real, incluido el cero", async () => {
    expect(await loadCard("x", "s1", async () => 0)).toEqual({ status: "ok", data: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("fallo de la base: estado de error (no un cero) y log sin el mensaje original", async () => {
    const state = await loadCard("customer_mix", "s1", () =>
      Promise.reject({ code: "57014", message: "canceling statement: ana@cliente.io" }),
    );
    expect(state).toEqual({ status: "error" });
    expect(warn).toHaveBeenCalledWith("home.card_failed", {
      card: "customer_mix",
      store_id: "s1",
      code: "internal",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("ana@cliente.io");
  });

  it("excepción de JS (p. ej. respuesta con otra forma): error", async () => {
    const state = await loadCard("store_alerts", "s1", () => {
      throw new TypeError("bad shape");
    });
    expect(state).toEqual({ status: "error" });
  });

  it("forbidden de la base: «sin permiso», no fallo", async () => {
    const state = await loadCard("recoverable_carts", "s1", () =>
      Promise.reject({ code: "42501", message: "forbidden" }),
    );
    expect(state).toEqual({ status: "forbidden" });
    expect(warn).not.toHaveBeenCalled();
  });
});
