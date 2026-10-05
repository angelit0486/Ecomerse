import { describe, expect, it } from "vitest";

import { AppError, ERROR_STATUS, errorResponse, toErrorEnvelope } from "./errors";

describe("toErrorEnvelope", () => {
  it("mapea AppError a su estado HTTP con mensaje en español", () => {
    const { status, body } = toErrorEnvelope(new AppError("forbidden"), "req-1");
    expect(status).toBe(403);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "forbidden",
        message: "No tienes permiso para realizar esta acción.",
        request_id: "req-1",
      },
    });
  });

  it("incluye errores por campo cuando existen", () => {
    const { body } = toErrorEnvelope(
      new AppError("validation_failed", undefined, { fields: { email: "Requerido" } }),
      "req-2",
    );
    expect(body.error.fields).toEqual({ email: "Requerido" });
  });

  it("nunca filtra detalles de errores no tipados", () => {
    const { status, body } = toErrorEnvelope(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      "req-3",
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal");
    expect(body.error.message).toBe("Ocurrió un error inesperado.");
    expect(JSON.stringify(body)).not.toContain("users_email_key");
  });

  it("todos los códigos tienen un estado HTTP de error", () => {
    for (const status of Object.values(ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  it("errorResponse responde sin caché", async () => {
    const response = errorResponse(new AppError("rate_limited"), "req-4");
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });
});
