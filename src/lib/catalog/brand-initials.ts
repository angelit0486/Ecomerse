/** Hasta dos iniciales del nombre de una marca («Muha Meds» → «MM»), para cuando no tiene logo. */
export function brandInitialsOf(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (
    words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}
