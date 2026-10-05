/**
 * Contraste WCAG 2.x entre dos colores hexadecimales (#rrggbb).
 * Lo usan los tokens del panel (Fase 1) y la validación de temas de tienda
 * (Fase 9, GATE0 §20.2: el contraste insuficiente bloquea la publicación).
 */

const HEX_RE = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  if (!HEX_RE.test(hex)) throw new Error(`Color inválido: ${hex}`);
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}
