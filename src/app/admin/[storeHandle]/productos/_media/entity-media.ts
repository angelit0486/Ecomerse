/**
 * Qué imágenes tiene cada cosa del catálogo y cómo se encuadran. Lo usan el
 * panel (componentes) y las acciones de servidor (RPC, permiso y texto
 * alternativo), así que no importa nada del servidor.
 */
export type MediaEntity = "brand" | "category";

export interface EntityImageKind {
  key: string;
  /** «logo», «foto»: en «Elegir logo», «Subir foto». */
  label: string;
  /** Leyenda del campo. */
  legend: string;
  /** Texto alternativo: «Logo de Muha Meds». */
  altPrefix: string;
  size: { width: number; height: number };
  square: boolean;
  removedMessage: string;
  /** «el logo», «la foto»: en «¿Quitar el logo de …?». */
  article: string;
}

export const ENTITY_MEDIA = {
  brand: {
    ownerType: "brand",
    rpc: "catalog_set_brand_media",
    idParam: "p_brand_id",
    path: "/productos/marcas",
    forbidden: "Tu rol no permite cambiar las marcas.",
    fallbackName: "la marca",
    bulkTitle: "Subir logos de varias marcas",
    bulkHint:
      "Nombra cada archivo como la marca (por ejemplo «muha-meds.png») y se asigna solo. Se acomodan en un cuadro sin recortar.",
    bulkDrop: "Arrastra aquí los logos o toca para elegirlos",
    bulkListLabel: "Logos por subir",
    bulkNone: "Sin marca (no se sube)",
    bulkPickLabel: "Marca de",
    bulkDuplicate: "Elegiste la misma marca para dos archivos. Deja una sola.",
    bulkUnit: ["logo", "logos"],
    bulkFit: "contain",
    kinds: [
      {
        key: "logo",
        label: "logo",
        legend: "Logo (cuadrado)",
        altPrefix: "Logo de",
        size: { width: 512, height: 512 },
        square: true,
        removedMessage: "Logo quitado.",
        article: "el logo",
      },
      {
        key: "cover",
        label: "portada",
        legend: "Portada de la marca (opcional)",
        altPrefix: "Portada de",
        size: { width: 1600, height: 600 },
        square: false,
        removedMessage: "Portada quitada.",
        article: "la portada",
      },
    ],
  },
  category: {
    ownerType: "category",
    rpc: "catalog_set_category_media",
    idParam: "p_category_id",
    path: "/productos/categorias",
    forbidden: "Tu rol no permite cambiar las categorías.",
    fallbackName: "la categoría",
    bulkTitle: "Subir fotos de varias categorías",
    bulkHint:
      "Nombra cada archivo como la categoría (por ejemplo «proteinas.jpg») y se asigna sola. Se recortan en cuadro al centro, como se ven en los círculos.",
    bulkDrop: "Arrastra aquí las fotos o toca para elegirlas",
    bulkListLabel: "Fotos por subir",
    bulkNone: "Sin categoría (no se sube)",
    bulkPickLabel: "Categoría de",
    bulkDuplicate: "Elegiste la misma categoría para dos archivos. Deja una sola.",
    bulkUnit: ["foto", "fotos"],
    bulkFit: "cover",
    kinds: [
      {
        key: "image",
        label: "foto",
        legend: "Foto (cuadrada: círculos, tarjetas y menú)",
        altPrefix: "Foto de",
        size: { width: 800, height: 800 },
        square: true,
        removedMessage: "Foto quitada.",
        article: "la foto",
      },
      {
        key: "cover",
        label: "banner",
        legend: "Banner de la página de la categoría (opcional)",
        altPrefix: "Banner de",
        size: { width: 1600, height: 600 },
        square: false,
        removedMessage: "Banner quitado.",
        article: "el banner",
      },
    ],
  },
} as const satisfies Record<
  MediaEntity,
  {
    ownerType: "brand" | "category";
    rpc: string;
    idParam: string;
    path: string;
    forbidden: string;
    fallbackName: string;
    bulkTitle: string;
    bulkHint: string;
    bulkDrop: string;
    bulkListLabel: string;
    bulkNone: string;
    bulkPickLabel: string;
    bulkDuplicate: string;
    bulkUnit: readonly [string, string];
    bulkFit: "contain" | "cover";
    kinds: readonly EntityImageKind[];
  }
>;

export function entityKind(entity: MediaEntity, key: string): EntityImageKind {
  return ENTITY_MEDIA[entity].kinds.find((k) => k.key === key) ?? ENTITY_MEDIA[entity].kinds[0];
}
