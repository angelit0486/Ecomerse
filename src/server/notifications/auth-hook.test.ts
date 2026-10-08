import { describe, expect, it } from "vitest";

import { loginNonce } from "./auth-hook";

describe("loginNonce", () => {
  it("lee solo un nonce bien formado del redirect_to", () => {
    const nonce = "0123456789abcdef0123456789abcdef";
    expect(loginNonce(`https://app.test/?pruva_login=${nonce}`)).toBe(nonce);
    expect(loginNonce("https://app.test/?pruva_login=NO")).toBeNull();
    expect(loginNonce("https://app.test/")).toBeNull();
    expect(loginNonce("no es una url")).toBeNull();
    expect(loginNonce(42)).toBeNull();
    expect(loginNonce(undefined)).toBeNull();
  });
});
