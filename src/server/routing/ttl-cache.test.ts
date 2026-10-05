import { describe, expect, it } from "vitest";

import { TtlCache } from "./ttl-cache";

describe("TtlCache", () => {
  it("caduca según el TTL", () => {
    let now = 1_000;
    const cache = new TtlCache<string>(10, () => now);
    cache.set("a", "uno", 60_000);
    expect(cache.get("a")).toBe("uno");
    now += 59_999;
    expect(cache.get("a")).toBe("uno");
    now += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("respeta el tamaño máximo descartando la entrada más antigua", () => {
    const cache = new TtlCache<number>(2);
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.set("c", 3, 60_000);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});
