import { describe, expect, it } from "vitest";

import { formValues, hasUnrenderedFieldError } from "./form-values";

describe("formValues", () => {
  it("devuelve solo las claves pedidas, vacías si faltan", () => {
    const fd = new FormData();
    fd.set("email", "a@b.mx");
    fd.set("secreto", "x");
    expect(formValues(fd, ["email", "name"])).toEqual({ email: "a@b.mx", name: "" });
  });
});

describe("hasUnrenderedFieldError", () => {
  it("sin campos o con un campo no mostrado: error general", () => {
    expect(hasUnrenderedFieldError(undefined, ["email"])).toBe(true);
    expect(hasUnrenderedFieldError({ ticket_ref: "x" }, ["email"])).toBe(true);
    expect(hasUnrenderedFieldError({ email: "x" }, ["email"])).toBe(false);
  });
});
