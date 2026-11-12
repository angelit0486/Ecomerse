/**
 * Codificador de códigos QR propio (O10-03), sin dependencias: modo byte,
 * corrección de errores nivel M (≈15 %), versiones 1 a 10 (hasta 213 bytes,
 * de sobra para el enlace de una tienda o de un producto). Sigue ISO/IEC 18004.
 *
 * Se escribió aquí para no sumar una dependencia por ~300 líneas (CLAUDE.md
 * regla 16): solo genera la matriz; quien la dibuja decide el formato.
 */

export type QrMatrix = readonly (readonly boolean[])[];

export class QrTooLongError extends Error {
  constructor() {
    super("El texto es demasiado largo para un código QR de versión 10.");
  }
}

const MAX_VERSION = 10;
// Nivel M, versiones 1..10: codewords de corrección por bloque y número de bloques.
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
// Bits de formato del nivel M (L=1, M=0, Q=3, H=2).
const ECL_M_BITS = 0;

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver - 1]! * NUM_BLOCKS[ver - 1]!;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// --- Reed-Solomon sobre GF(256), polinomio 0x11D ---

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < degree) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMul(coef, factor)));
  }
  return result;
}

// --- Datos ---

function encodeData(bytes: Uint8Array, ver: number): number[] {
  const capacityBits = dataCodewords(ver) * 8;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // modo byte
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length)); // terminador
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  return out;
}

function addEccAndInterleave(data: number[], ver: number): number[] {
  const numBlocks = NUM_BLOCKS[ver - 1]!;
  const eccLen = ECC_PER_BLOCK[ver - 1]!;
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0); // hueco para igualar longitudes al intercalar
    blocks.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]!);
    });
  }
  return result;
}

// --- Matriz ---

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  fn(x: number, y: number, isDark: boolean): void {
    this.dark[y]![x] = isDark;
    this.reserved[y]![x] = true;
  }

  drawFunctionPatterns(): void {
    const { size } = this;
    for (let i = 0; i < size; i++) {
      this.fn(6, i, i % 2 === 0);
      this.fn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(size - 4, 3);
    this.finder(3, size - 4);
    const align = alignmentPositions(this.version);
    const last = align.length - 1;
    align.forEach((ay, i) =>
      align.forEach((ax, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            this.fn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }),
    );
    this.drawFormat(0); // reserva; se reescribe con la máscara elegida
    this.drawVersion();
  }

  private finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.fn(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  drawFormat(mask: number): void {
    const data = (ECL_M_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const { size } = this;
    for (let i = 0; i <= 5; i++) this.fn(8, i, bit(i));
    this.fn(8, 7, bit(6));
    this.fn(8, 8, bit(7));
    this.fn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.fn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.fn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.fn(8, size - 15 + i, bit(i));
    this.fn(8, size - 8, true); // módulo oscuro fijo
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const isDark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.fn(a, b, isDark);
      this.fn(b, a, isDark);
    }
  }

  drawCodewords(codewords: readonly number[]): void {
    const { size } = this;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // la columna de sincronía no lleva datos
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = upward ? size - 1 - vert : vert;
          if (!this.reserved[y]![x] && i < codewords.length * 8) {
            this.dark[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.reserved[y]![x] && maskBit(mask, x, y)) this.dark[y]![x] = !this.dark[y]![x];
      }
    }
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Penalización de la norma (reglas 1 a 4): elige la máscara más fácil de leer. */
function penalty(dark: boolean[][]): number {
  const size = dark.length;
  let score = 0;
  const line = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        if (j < size && get(i, j) === get(i, j - 1)) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      for (let j = 0; j + 11 <= size; j++) {
        const s = Array.from({ length: 11 }, (_, k) => (get(i, j + k) ? 1 : 0)).join("");
        if (s === "10111010000" || s === "00001011101") score += 40;
      }
    }
  };
  line((i, j) => dark[i]![j]!);
  line((i, j) => dark[j]![i]!);
  let darkCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (dark[y]![x]) darkCount++;
      if (
        x < size - 1 &&
        y < size - 1 &&
        dark[y]![x] === dark[y]![x + 1] &&
        dark[y]![x] === dark[y + 1]![x] &&
        dark[y]![x] === dark[y + 1]![x + 1]
      ) {
        score += 3;
      }
    }
  }
  const total = size * size;
  score += Math.max(0, Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Matriz del QR (true = módulo oscuro), sin zona de silencio. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const header = 4 + (ver < 10 ? 8 : 16);
    if (header + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > MAX_VERSION) throw new QrTooLongError();
  const codewords = addEccAndInterleave(encodeData(bytes, ver), ver);
  let best: { score: number; dark: boolean[][] } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = new Grid(ver);
    grid.drawFunctionPatterns();
    grid.drawCodewords(codewords);
    grid.applyMask(mask);
    grid.drawFormat(mask);
    const score = penalty(grid.dark);
    if (!best || score < best.score) best = { score, dark: grid.dark };
  }
  return best!.dark;
}

/**
 * Trazo SVG (un solo `path`) con zona de silencio de 4 módulos. Devuelve el
 * lado total en módulos para el `viewBox`.
 */
export function qrSvgPath(matrix: QrMatrix, quiet = 4): { d: string; size: number } {
  const parts: string[] = [];
  matrix.forEach((row, y) =>
    row.forEach((isDark, x) => {
      if (isDark) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }),
  );
  return { d: parts.join(""), size: matrix.length + quiet * 2 };
}
