/**
 * Marca PRUVA (fase 3; decisiones del propietario del 2026-10-19): marca de la
 * plataforma en el panel, la consola y el acceso. Las tiendas no la usan desde
 * el código (white-label): la tienda PRUVA sube su logo en Apariencia como
 * cualquier otra (docs/marca/PRUVA.md).
 *
 * Geometría propia, sin fuentes ni efectos: letras de trazo 22 sobre una altura
 * de 100, inclinadas 12°, y un símbolo de dos piezas (asta y panza) que da el
 * paso hacia adelante. Todo usa `currentColor`: el color lo pone el contenedor
 * (azul marino sobre claro, blanco frío sobre azul marino).
 */

const SKEW = "skewX(-12)";

function SymbolShape() {
  return (
    <g transform={`${SKEW} translate(22 0)`}>
      <rect width="24" height="100" />
      <path d="M32 0H60A32 32 0 0 1 60 64H32Z" />
    </g>
  );
}

function WordmarkShape() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="22" strokeLinejoin="miter">
      <g transform={`translate(24 0) ${SKEW}`}>
        <path d="M11 100V11H45A24 24 0 0 1 45 59H11" />
        <path transform="translate(96 0)" d="M11 100V11H45A24 24 0 0 1 45 59H11" />
        <path
          transform="translate(96 0)"
          fill="currentColor"
          stroke="none"
          d="M34 60H58L80 100H56Z"
        />
        <path transform="translate(192 0)" d="M11 0V60A29 29 0 0 0 69 60V0" />
        {/* Pierna de la R, V y A rellenas con cortes planos: un trazo en ángulo agudo
            deja puntas fuera de la línea base. */}
        <path
          transform="translate(288 0)"
          fill="currentColor"
          stroke="none"
          d="M0 0H23L40 62L57 0H80L52 100H28Z"
        />
        <path
          transform="translate(384 0)"
          fill="currentColor"
          stroke="none"
          fillRule="evenodd"
          d="M0 100H23L28.5 80H51.5L57 100H80L52 0H28ZM33.4 62H46.6L40 38Z"
        />
      </g>
    </g>
  );
}

type LogoProps = { className?: string; title?: string };

/** Símbolo solo (versión compacta): íconos, favicon y espacios cuadrados. */
export function PruvaSymbol({ className, title = "PRUVA" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 116 100"
      role="img"
      aria-label={title}
      fill="currentColor"
      className={className}
    >
      <SymbolShape />
    </svg>
  );
}

/** Logotipo PRUVA sin símbolo. */
export function PruvaWordmark({ className, title = "PRUVA" }: LogoProps) {
  return (
    <svg viewBox="0 -6 492 112" role="img" aria-label={title} className={className}>
      <WordmarkShape />
    </svg>
  );
}

/**
 * Versión horizontal: símbolo + logotipo. El logotipo mide el 72 % de la altura
 * del símbolo y la separación es el 40 % (reglas en docs/marca/PRUVA.md).
 */
export function PruvaLogo({ className, title = "PRUVA" }: LogoProps) {
  return (
    <svg
      viewBox="0 -6 532 112"
      role="img"
      aria-label={title}
      fill="currentColor"
      className={className}
    >
      <SymbolShape />
      <g transform="translate(156 14) scale(0.72)">
        <WordmarkShape />
      </g>
    </svg>
  );
}
