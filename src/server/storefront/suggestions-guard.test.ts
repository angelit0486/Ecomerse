import { describe, expect, it } from "vitest";

import { createSuggestionsGuard } from "./suggestions-guard";

describe("freno de sugerencias del buscador", () => {
  it("limita por IP dentro de la ventana y se reinicia al terminar", () => {
    let now = 0;
    const guard = createSuggestionsGuard({ perWindow: 3, windowMs: 10_000, now: () => now });
    for (let i = 0; i < 3; i += 1) guard.take("ip-a")!.release();
    expect(guard.take("ip-a")).toBeNull();
    // Otra IP no se ve afectada.
    const other = guard.take("ip-b");
    expect(other).not.toBeNull();
    other!.release();
    now += 10_000;
    expect(guard.take("ip-a")).not.toBeNull();
  });

  it("no deja más consultas en curso que el máximo, aunque sean de IP distintas", () => {
    const guard = createSuggestionsGuard({ maxInFlight: 1 });
    const first = guard.take("ip-a");
    expect(first).not.toBeNull();
    expect(guard.take("ip-b")).toBeNull();
    first!.release();
    expect(guard.take("ip-b")).not.toBeNull();
  });

  it("liberar dos veces no abre turnos de más", () => {
    const guard = createSuggestionsGuard({ maxInFlight: 1 });
    const first = guard.take("ip-a")!;
    first.release();
    first.release();
    const second = guard.take("ip-b");
    expect(second).not.toBeNull();
    expect(guard.take("ip-c")).toBeNull();
  });

  it("un rechazo por turno no gasta el presupuesto de la IP", () => {
    const guard = createSuggestionsGuard({ perWindow: 1, maxInFlight: 1 });
    const busy = guard.take("ip-a")!;
    expect(guard.take("ip-b")).toBeNull();
    busy.release();
    expect(guard.take("ip-b")).not.toBeNull();
  });
});
