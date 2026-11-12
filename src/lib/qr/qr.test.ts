import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeQr, qrSvgPath, QrTooLongError, type QrMatrix } from "./qr";

const hash = (m: QrMatrix) =>
  createHash("sha256")
    .update(m.map((r) => r.map((b) => (b ? "1" : "0")).join("")).join("\n"))
    .digest("hex");

describe("encodeQr", () => {
  // Matrices comprobadas módulo por módulo contra la librería de referencia
  // `qrcode` 1.5.4 (misma máscara) y leídas con el lector `jsQR` 1.4.0, fuera
  // del repositorio (O10-03). Cubren versiones 3 a 8, incluida la información
  // de versión (≥ 7).
  it.each([
    [
      "https://ropa-demo.pruva.mx/productos/playera-basica",
      4,
      "9812b009b911fbe0483bc025b6c8c25d8da4ca7f31407e05ec2a847ef92e26de",
    ],
    [
      "https://tienda.example.com/",
      3,
      "8c971f9d00dbef2242999191b8927444b2ac8fb74b98e8deb4e8ece8ac597584",
    ],
    [
      "https://abarrotes-lupita.pruva.mx/productos/frijol-negro-1-kg?x=1",
      5,
      "3e8b0aae9b720cc5ea432b0fcc172f1edc8c9271afec91c5a70d43680b9663b7",
    ],
    [
      `https://hogar.mx/${"a".repeat(80)}`,
      6,
      "d3e5e9baf93d6e77c0e6766dac56eb579bb17073bbebe4dc9184daba57835d73",
    ],
    ["x".repeat(150), 8, "9782fa7f0642d3e6b22295c01fc9e2fe9a0f19d22af2cf7b3964dcb6a932e44e"],
  ])("%s → versión %i idéntica a la referencia", (text, version, expected) => {
    const m = encodeQr(text);
    expect(m.length).toBe(version * 4 + 17);
    expect(hash(m)).toBe(expected);
  });

  it("dibuja los tres patrones de posición y la línea de sincronía", () => {
    const m = encodeQr("https://tienda.example.com/");
    const n = m.length;
    for (const [cx, cy] of [
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
    ] as const) {
      expect(m[cy]![cx]).toBe(true); // centro
      expect(m[cy]![cx - 2]).toBe(false); // anillo claro
      expect(m[cy]![cx - 3]).toBe(true); // borde oscuro
    }
    for (let i = 8; i < n - 8; i++) expect(m[6]![i]).toBe(i % 2 === 0);
    expect(m[n - 8]![8]).toBe(true); // módulo oscuro fijo
  });

  it("acepta hasta 213 bytes y rechaza más (versión 10)", () => {
    expect(encodeQr("x".repeat(213)).length).toBe(57);
    expect(() => encodeQr("x".repeat(214))).toThrow(QrTooLongError);
    // Acentos: cuentan como 2 bytes en UTF-8.
    expect(() => encodeQr("á".repeat(107))).toThrow(QrTooLongError);
  });

  it("es determinista", () => {
    expect(hash(encodeQr("https://a.mx/"))).toBe(hash(encodeQr("https://a.mx/")));
  });
});

describe("qrSvgPath", () => {
  it("agrega la zona de silencio y un cuadro por módulo oscuro", () => {
    const m = encodeQr("https://a.mx/");
    const { d, size } = qrSvgPath(m);
    expect(size).toBe(m.length + 8);
    const dark = m.flat().filter(Boolean).length;
    expect(d.match(/M/g)).toHaveLength(dark);
    expect(d.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
