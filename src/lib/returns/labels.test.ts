import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RETURN_REASON_LABEL,
  RETURN_REASONS,
  RETURN_STATUS_FOR_CUSTOMER,
  RETURN_STATUS_LABEL,
} from "./labels";

const migration = readFileSync("supabase/migrations/20261105000600_returns.sql", "utf8");

describe("devoluciones: textos (ADR-061)", () => {
  it("cada motivo de la base tiene texto, y no hay motivos de más", () => {
    const check = /reason\s+text not null\s+check \(reason in \(([^)]*)\)\)/.exec(migration);
    const reasons = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(reasons).toEqual([...RETURN_REASONS]);
    for (const r of reasons) expect(RETURN_REASON_LABEL[r!]).toBeTruthy();
  });

  it("cada estado tiene texto para la tienda y para el cliente", () => {
    for (const s of ["requested", "approved", "received", "closed", "rejected"]) {
      expect(RETURN_STATUS_LABEL[s]).toBeTruthy();
      expect(RETURN_STATUS_FOR_CUSTOMER[s]).toBeTruthy();
    }
  });
});
