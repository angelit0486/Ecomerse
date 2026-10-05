import { describe, expect, it } from "vitest";

import { totp } from "../support/totp";

describe("totp (RFC 6238)", () => {
  // Vector del Apéndice B de RFC 6238 (secreto ASCII "12345678901234567890", SHA-1),
  // truncado a 6 dígitos.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // gitleaks:allow (vector público)

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (seconds, expected) => {
    expect(totp(secret, seconds * 1000)).toBe(expected);
  });
});
