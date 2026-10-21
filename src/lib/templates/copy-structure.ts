/** Partes que `store_copy_structure` sabe copiar (D-PUL-02), con su permiso en el destino. */
export const COPY_PARTS = [
  {
    key: "categories",
    label: "Categorías (con su descripción y SEO)",
    permission: "categories.manage",
  },
  { key: "pages", label: "Páginas de contenido, en borrador", permission: "content.manage" },
  { key: "policies", label: "Políticas ya completadas, en borrador", permission: "content.manage" },
  {
    key: "menus",
    label: "Menús (si los de esta tienda están vacíos)",
    permission: "appearance.manage",
  },
] as const;

export type CopyPart = (typeof COPY_PARTS)[number]["key"];

export interface CopyCounts {
  categories: number;
  pages: number;
  policies: number;
  menu_items: number;
  skipped: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function list(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Aviso tras copiar: qué llegó, qué queda en borrador y qué se omitió. */
export function structureCopiedMessage(c: CopyCounts): string {
  const copied = [
    c.categories ? plural(c.categories, "categoría", "categorías") : "",
    c.pages ? plural(c.pages, "página", "páginas") : "",
    c.policies ? plural(c.policies, "política", "políticas") : "",
    c.menu_items ? plural(c.menu_items, "entrada del menú", "entradas del menú") : "",
  ].filter(Boolean);
  if (copied.length === 0) return "No había nada nuevo que copiar: esta tienda ya tiene todo eso.";
  let message = `Copiamos ${list(copied)}.`;
  if (c.pages || c.policies)
    message += " Las páginas y políticas quedan en borrador para que las revises.";
  if (c.skipped) {
    message += ` ${plural(c.skipped, "elemento no se copió", "elementos no se copiaron")} porque depende${c.skipped === 1 ? "" : "n"} de productos o marcas de la otra tienda.`;
  }
  return message;
}
