import { describe, expect, it } from "vitest";

import { photoProgress } from "./progress";

describe("photoProgress", () => {
  it("sin fotos: no hay nada que esperar", () => {
    expect(photoProgress({ pending: 0, ready: 0, rejected: 0 })).toMatchObject({
      total: 0,
      percent: 100,
      done: true,
    });
  });

  it("cuenta listas y rechazadas como terminadas", () => {
    const p = photoProgress({ pending: 250, ready: 700, rejected: 50 });
    expect(p).toMatchObject({ total: 1000, percent: 75, done: false });
    expect(p.summary).toBe("700 fotos listas · 250 en proceso · 50 no se pudieron usar.");
  });

  it("nunca dice 100 % mientras quede una en proceso", () => {
    expect(photoProgress({ pending: 1, ready: 9999, rejected: 0 })).toMatchObject({
      percent: 99,
      done: false,
    });
  });

  it("todo terminado, en singular", () => {
    const p = photoProgress({ pending: 0, ready: 1, rejected: 1 });
    expect(p).toMatchObject({ percent: 100, done: true });
    expect(p.summary).toBe("1 foto lista · 1 no se pudo usar.");
  });

  it("valores negativos no rompen el cálculo", () => {
    expect(photoProgress({ pending: -5, ready: 2, rejected: 0 })).toMatchObject({
      total: 2,
      percent: 100,
    });
  });
});
