import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

const { notFound } = await import("next/navigation");
const { notFoundOrThrow } = await import("./not-found-or-throw");

describe("notFoundOrThrow", () => {
  it("AppError not_found → notFound()", () => {
    expect(() => notFoundOrThrow(new AppError("not_found"))).toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("otro AppError se relanza tal cual (no es un 404)", () => {
    vi.mocked(notFound).mockClear();
    const internal = new AppError("internal");
    expect(() => notFoundOrThrow(internal)).toThrow(internal);
    const forbidden = new AppError("forbidden");
    expect(() => notFoundOrThrow(forbidden)).toThrow(forbidden);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("un error de red cualquiera se relanza", () => {
    vi.mocked(notFound).mockClear();
    const network = new TypeError("fetch failed");
    expect(() => notFoundOrThrow(network)).toThrow(network);
    expect(notFound).not.toHaveBeenCalled();
  });
});
