import { describe, expect, it } from "vitest";

import { pickupInfo } from "./pickup";

describe("pickupInfo", () => {
  it("devuelve dirección y horario declarados", () => {
    expect(pickupInfo({ address: " Calle 5 #10, Hermosillo ", hours: "L-S 10-19" })).toEqual({
      address: "Calle 5 #10, Hermosillo",
      hours: "L-S 10-19",
    });
  });
  it("acepta solo uno de los dos", () => {
    expect(pickupInfo({ address: "Calle 5" })).toEqual({ address: "Calle 5", hours: null });
    expect(pickupInfo({ hours: "10-19" })).toEqual({ address: null, hours: "10-19" });
  });
  it("devuelve null si no hay datos", () => {
    expect(pickupInfo(undefined)).toBeNull();
    expect(pickupInfo(null)).toBeNull();
    expect(pickupInfo({ address: "  ", hours: "" })).toBeNull();
  });
});
