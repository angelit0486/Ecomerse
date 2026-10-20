import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { SCHEMA_OUTDATED_MESSAGE, toAppError } from "./errors";

describe("toAppError", () => {
  it.each([
    ["unauthenticated", "unauthenticated"],
    ["mfa_required", "mfa_required"],
    ["forbidden", "forbidden"],
    ["permission denied for table stores", "forbidden"],
    ["algo_inventado", "forbidden"],
  ])("42501 %s → %s", (message, expected) => {
    expect(toAppError({ code: "42501", message }).code).toBe(expected);
  });

  it("P0001 con código de negocio conocido", () => {
    expect(toAppError({ code: "P0001", message: "not_found", details: "store" }).code).toBe(
      "not_found",
    );
    expect(toAppError({ code: "P0001", message: "limit_reached" }).code).toBe("limit_reached");
  });

  it("validation_failed lleva el campo del detalle", () => {
    const error = toAppError({ code: "P0001", message: "validation_failed", details: "email" });
    expect(error.code).toBe("validation_failed");
    expect(error.fields).toEqual({ email: "invalid" });
  });

  it("un detalle que no es nombre de campo no se expone", () => {
    const error = toAppError({
      code: "P0001",
      message: "validation_failed",
      details: '{"key":"x"} con datos',
    });
    expect(error.fields).toBeUndefined();
  });

  it("alias de negocio de la aceptación de invitaciones", () => {
    expect(toAppError({ code: "P0001", message: "invitation_invalid" }).code).toBe("not_found");
    expect(toAppError({ code: "P0001", message: "invitation_email_mismatch" }).code).toBe(
      "forbidden",
    );
  });

  it("P0001 desconocido o 'internal' → internal, sin filtrar el mensaje", () => {
    const error = toAppError({ code: "P0001", message: "platform_not_configured" });
    expect(error.code).toBe("internal");
    expect(error.message).not.toContain("platform_not_configured");
    expect(toAppError({ code: "P0001", message: "internal" }).code).toBe("internal");
  });

  it("errores de integridad y de JWT", () => {
    expect(toAppError({ code: "23505", message: "duplicate key value" }).code).toBe("conflict");
    expect(toAppError({ code: "23514", message: "violates check" }).code).toBe("validation_failed");
    expect(toAppError({ code: "PGRST301", message: "JWT expired" }).code).toBe("unauthenticated");
  });

  it("función o columna que falta: base sin actualizar, con mensaje accionable (D-EST-04)", () => {
    for (const code of ["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"]) {
      const e = toAppError({ code, message: "function app.x() does not exist" });
      expect(e.code, code).toBe("internal");
      expect(e.message, code).toBe(SCHEMA_OUTDATED_MESSAGE);
    }
  });

  it("errores arbitrarios → internal; AppError pasa tal cual", () => {
    expect(toAppError(new Error("boom")).code).toBe("internal");
    expect(toAppError("texto").code).toBe("internal");
    const original = new AppError("conflict");
    expect(toAppError(original)).toBe(original);
  });

  it("el mensaje interno de la base nunca llega al AppError", () => {
    const error = toAppError({ code: "XX000", message: "relation app.secret does not exist" });
    expect(error.message).not.toContain("app.secret");
  });
});
