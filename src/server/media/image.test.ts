import { deflateSync } from "node:zlib";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MAX_IMAGE_SIDE, processImage, sniffImageMime } from "./image";

const MB10 = 10 * 1024 * 1024;

async function solid(format: "jpeg" | "png" | "webp" | "avif", width = 64, height = 48) {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  });
  return base.toFormat(format).toBuffer();
}

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG de 1 bit en escala de grises, todo ceros: pocos KB que declaran muchos megapíxeles. */
function pngBomb(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // profundidad de bits
  ihdr[9] = 0; // escala de grises
  const row = Math.ceil(width / 8) + 1;
  const raw = Buffer.alloc(row * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("sniffImageMime", () => {
  it("reconoce los cuatro formatos permitidos por sus magic bytes", async () => {
    expect(sniffImageMime(await solid("jpeg"))).toBe("image/jpeg");
    expect(sniffImageMime(await solid("png"))).toBe("image/png");
    expect(sniffImageMime(await solid("webp"))).toBe("image/webp");
    expect(sniffImageMime(await solid("avif"))).toBe("image/avif");
  });

  it("no reconoce SVG, GIF, HTML ni archivos vacíos", () => {
    expect(
      sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
    expect(sniffImageMime(Buffer.from("GIF89a\x01\x00\x01\x00"))).toBeNull();
    expect(sniffImageMime(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("processImage", () => {
  it("re-codifica una imagen válida y devuelve sus dimensiones", async () => {
    const result = await processImage(await solid("png", 120, 80), "image/png", MB10);
    expect(result).toMatchObject({ ok: true, width: 120, height: 80, mime: "image/png" });
  });

  it("elimina EXIF (incluida la ubicación) y aplica la orientación", async () => {
    const withExif = await sharp(await solid("jpeg", 60, 40))
      .withExif({ IFD0: { Make: "Teléfono" }, IFD3: { GPSLatitudeRef: "N" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const before = await sharp(withExif).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const result = await processImage(withExif, "image/jpeg", MB10);
    if (!result.ok) throw new Error(result.reason);
    const out = await sharp(result.data).metadata();
    expect(out.exif).toBeUndefined();
    expect(out.icc).toBeUndefined();
    expect([result.width, result.height]).toEqual([40, 60]); // rotada 90°
  });

  it("reduce a 4096 px por lado como máximo", async () => {
    const result = await processImage(await solid("jpeg", 5000, 1000), "image/jpeg", MB10);
    if (!result.ok) throw new Error(result.reason);
    expect(result.width).toBe(MAX_IMAGE_SIDE);
    expect(result.height).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
  });

  it("polyglot: el contenido añadido tras la imagen no sobrevive", async () => {
    const payload = "<script>alert(document.cookie)</script>PK\x03\x04";
    const polyglot = Buffer.concat([await solid("jpeg"), Buffer.from(payload)]);
    const result = await processImage(polyglot, "image/jpeg", MB10);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.includes(Buffer.from("<script>"))).toBe(false);
    expect(result.data.includes(Buffer.from("PK\x03\x04", "latin1"))).toBe(false);
  });

  it("rechaza SVG (aunque se declare como imagen permitida)", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect(await processImage(svg, "image/png", MB10)).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
  });

  it("rechaza un MIME falso (PNG declarado como JPEG)", async () => {
    expect(await processImage(await solid("png"), "image/jpeg", MB10)).toEqual({
      ok: false,
      reason: "mime_mismatch",
    });
  });

  it("rechaza GIF y HTML disfrazados", async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    expect(await processImage(gif, "image/jpeg", MB10)).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
    const html = Buffer.from("<html><body onload=alert(1)>");
    expect(await processImage(html, "image/jpeg", MB10)).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
  });

  it("rechaza una bomba de descompresión por el límite de píxeles", async () => {
    const bomb = pngBomb(10_000, 10_000); // 100 MP en pocos KB
    expect(bomb.length).toBeLessThan(200_000);
    expect(await processImage(bomb, "image/png", MB10)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
  });

  it("rechaza archivos corruptos con cabecera válida", async () => {
    const jpeg = await solid("jpeg");
    const corrupt = Buffer.concat([jpeg.subarray(0, 4), Buffer.alloc(200, 0x41)]);
    expect(await processImage(corrupt, "image/jpeg", MB10)).toEqual({
      ok: false,
      reason: "decode_failed",
    });
  });

  it("rechaza archivos vacíos o por encima del máximo", async () => {
    expect(await processImage(Buffer.alloc(0), "image/jpeg", MB10)).toEqual({
      ok: false,
      reason: "too_large",
    });
    const jpeg = await solid("jpeg");
    expect(await processImage(jpeg, "image/jpeg", jpeg.length - 1)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});
