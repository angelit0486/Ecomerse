import { describe, expect, it } from "vitest";

import { MAINTENANCE_EVERY_MS, maintenanceThrottle } from "./maintenance-throttle";

describe("mantenimiento al procesar la cola tras una acción", () => {
  it("la primera vez sí; dentro del minuto no; después del minuto otra vez", () => {
    const due = maintenanceThrottle();
    expect(due(1_000)).toBe(true);
    expect(due(1_000 + MAINTENANCE_EVERY_MS - 1)).toBe(false);
    expect(due(1_000 + MAINTENANCE_EVERY_MS)).toBe(true);
  });

  it("cada instancia lleva su propia cuenta", () => {
    const a = maintenanceThrottle(10);
    const b = maintenanceThrottle(10);
    expect(a(0)).toBe(true);
    expect(b(5)).toBe(true);
    expect(a(5)).toBe(false);
  });
});
