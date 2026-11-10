/**
 * Archivos exportados de otras plataformas → columnas de la importación de PRUVA.
 *
 * Quien ya vende en Shopify o Tiendanube sube el CSV tal como lo descarga de su
 * panel; aquí se traduce fila por fila a las columnas que entiende
 * `planProductImport` (mismo validador, misma base como autoridad). Solo se
 * traduce lo que significa lo mismo en ambos lados: nunca se inventan datos.
 *
 * Lo que no se traduce y por qué:
 *   - Categorías: en PRUVA deben existir antes; se asignan en bloque después.
 *   - Fotos: los enlaces de cada producto (incluidas las filas de Shopify que solo
 *     traen una foto extra) van a `image_urls` de su primera fila; el worker los
 *     descarga al confirmar con los controles de SSRF (ADR-033, GATE0 T-08).
 */

export type SourcePlatform = "pruva" | "shopify" | "tiendanube" | "hoja";

export interface TranslatedCsv {
  platform: SourcePlatform;
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
  /** Columnas del archivo original que no tienen equivalente. */
  ignored: string[];
  /** Filas de Shopify que solo traen una foto extra del producto. */
  imageOnlyRows: number;
  /** Productos con enlaces de fotos en el archivo (se descargan al confirmar). */
  productsWithImageUrl: number;
}

/** Minúsculas, sin acentos ni espacios repetidos: «Código de barras» = «codigo de barras». */
export function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Hoja simple en español (plan 2026-11-05, fase C): nombre y precio, sin nombre corto. */
const SHEET_TITLE = ["producto", "nombre del producto", "nombre"];
const SHEET_PRICE = ["precio", "precio de venta"];

export function detectPlatform(headers: readonly string[]): SourcePlatform {
  const set = new Set(headers.map(normalizeHeader));
  if (set.has("identificador de url") && set.has("nombre")) return "tiendanube";
  if (set.has("handle") && (set.has("variant price") || set.has("body (html)"))) return "shopify";
  if (
    !set.has("handle") &&
    SHEET_TITLE.some((h) => set.has(h)) &&
    SHEET_PRICE.some((h) => set.has(h))
  ) {
    return "hoja";
  }
  return "pruva";
}

/**
 * Importe escrito como «1,234.50», «1.234,50», «1234,5» o «$199»: devuelve
 * «1234.50». Si no se reconoce, se devuelve tal cual y el validador lo explica.
 */
export function normalizeMoney(value: string): string {
  const v = value
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(v)) return v.replace(/\./g, "").replace(",", ".");
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(v)) return v.replace(/,/g, "");
  if (/^\d+,\d{1,2}$/.test(v)) return v.replace(",", ".");
  return v;
}

/** Número decimal (punto o coma) multiplicado y redondeado; vacío si no es número. */
function scaled(value: string, factor: number): string {
  const v = value.trim().replace(",", ".");
  if (!v) return "";
  if (!/^\d+(\.\d+)?$/.test(v)) return value.trim();
  return String(Math.round(Number(v) * factor));
}

/** Existencias: Shopify deja negativas las vendidas de más; en PRUVA no hay menos de 0. */
function quantity(value: string): string {
  const v = value.trim();
  if (/^-\d+$/.test(v)) return "0";
  return v;
}

const yesNo = (value: string): string => {
  const t = normalizeHeader(value);
  if (["si", "sí", "yes", "true", "1"].includes(t)) return "true";
  if (["no", "false", "0"].includes(t)) return "false";
  return value.trim();
};

/** «proteina, whey , vegano» → «proteina|whey|vegano». */
const commaList = (value: string): string =>
  value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .join("|");

type Getter = (header: string) => string;

interface PlatformSpec {
  /**
   * Columna de PRUVA → encabezados de origen (normalizados) de los que sale. Solo
   * se emite si el archivo trae alguno: una columna ausente no cambia nada en
   * PRUVA (D-F8-06) y una presente y vacía sí borra el dato.
   */
  sources: Readonly<Record<string, readonly string[]>>;
  imageHeaders: readonly string[];
  /** true: fila que no describe una presentación (se descarta). */
  skip?: (get: Getter) => boolean;
  translate: (get: Getter) => Record<string, string>;
}

const SHOPIFY: PlatformSpec = {
  sources: {
    handle: ["handle"],
    title: ["title"],
    description: ["body (html)"],
    brand: ["vendor"],
    tags: ["tags"],
    status: ["status", "published"],
    option1_name: ["option1 name"],
    option1_value: ["option1 value"],
    option2_name: ["option2 name"],
    option2_value: ["option2 value"],
    option3_name: ["option3 name"],
    option3_value: ["option3 value"],
    sku: ["variant sku"],
    barcode: ["variant barcode"],
    price: ["variant price"],
    compare_at_price: ["variant compare at price"],
    cost: ["cost per item"],
    inventory_quantity: ["variant inventory qty"],
    inventory_policy: ["variant inventory policy"],
    requires_shipping: ["variant requires shipping"],
    weight_g: ["variant grams"],
    seo_title: ["seo title"],
    seo_description: ["seo description"],
    image_urls: ["image src", "variant image"],
  },
  imageHeaders: ["image src", "variant image"],
  // Shopify agrega una fila por cada foto extra: solo trae Handle e Image Src.
  skip: (get) =>
    !get("title") &&
    !get("option1 value") &&
    !get("variant sku") &&
    !get("variant price") &&
    !get("variant barcode"),
  translate(get) {
    // Producto sin opciones: Shopify escribe «Title» / «Default Title».
    const single =
      normalizeHeader(get("option1 name")) === "title" &&
      normalizeHeader(get("option1 value")) === "default title";
    const status =
      get("status") ||
      (get("published") ? (yesNo(get("published")) === "true" ? "active" : "draft") : "");
    return {
      handle: get("handle"),
      title: get("title"),
      description: get("body (html)"),
      brand: get("vendor"),
      tags: commaList(get("tags")),
      status,
      option1_name: single ? "" : get("option1 name"),
      option1_value: single ? "" : get("option1 value"),
      option2_name: get("option2 name"),
      option2_value: get("option2 value"),
      option3_name: get("option3 name"),
      option3_value: get("option3 value"),
      sku: get("variant sku"),
      barcode: get("variant barcode"),
      price: normalizeMoney(get("variant price")),
      compare_at_price: normalizeMoney(get("variant compare at price")),
      cost: normalizeMoney(get("cost per item")),
      inventory_quantity: quantity(get("variant inventory qty")),
      inventory_policy: get("variant inventory policy"),
      requires_shipping: yesNo(get("variant requires shipping")),
      weight_g: scaled(get("variant grams"), 1),
      seo_title: get("seo title"),
      seo_description: get("seo description"),
    };
  },
};

const TIENDANUBE: PlatformSpec = {
  sources: {
    handle: ["identificador de url"],
    title: ["nombre"],
    description: ["descripcion"],
    brand: ["marca"],
    tags: ["tags"],
    status: ["mostrar en tienda"],
    option1_name: ["nombre de propiedad 1"],
    option1_value: ["valor de propiedad 1"],
    option2_name: ["nombre de propiedad 2"],
    option2_value: ["valor de propiedad 2"],
    option3_name: ["nombre de propiedad 3"],
    option3_value: ["valor de propiedad 3"],
    sku: ["sku"],
    barcode: ["codigo de barras"],
    price: ["precio", "precio promocional"],
    compare_at_price: ["precio promocional"],
    cost: ["costo"],
    inventory_quantity: ["stock"],
    requires_shipping: ["producto fisico"],
    weight_g: ["peso (kg)"],
    height_mm: ["alto (cm)"],
    width_mm: ["ancho (cm)"],
    length_mm: ["profundidad (cm)"],
    seo_title: ["titulo para seo"],
    seo_description: ["descripcion para seo"],
  },
  imageHeaders: [],
  translate(get) {
    // «Precio» es el de lista; si hay «Precio promocional» menor, ese es el que se
    // cobra y el de lista queda como precio anterior (tachado).
    const list = normalizeMoney(get("precio"));
    const promo = normalizeMoney(get("precio promocional"));
    const onSale = promo !== "" && list !== "" && Number(promo) < Number(list);
    const visible = get("mostrar en tienda");
    return {
      handle: get("identificador de url"),
      title: get("nombre"),
      description: get("descripcion"),
      brand: get("marca"),
      tags: commaList(get("tags")),
      status: visible ? (yesNo(visible) === "true" ? "active" : "draft") : "",
      option1_name: get("nombre de propiedad 1"),
      option1_value: get("valor de propiedad 1"),
      option2_name: get("nombre de propiedad 2"),
      option2_value: get("valor de propiedad 2"),
      option3_name: get("nombre de propiedad 3"),
      option3_value: get("valor de propiedad 3"),
      sku: get("sku"),
      barcode: get("codigo de barras"),
      price: onSale ? promo : list,
      compare_at_price: onSale ? list : "",
      cost: normalizeMoney(get("costo")),
      // Vacío en Tiendanube = sin control de existencias: aquí, no se tocan.
      inventory_quantity: quantity(get("stock")),
      requires_shipping: get("producto fisico") ? yesNo(get("producto fisico")) : "",
      weight_g: scaled(get("peso (kg)"), 1000),
      height_mm: scaled(get("alto (cm)"), 10),
      width_mm: scaled(get("ancho (cm)"), 10),
      length_mm: scaled(get("profundidad (cm)"), 10),
      seo_title: get("titulo para seo"),
      seo_description: get("descripcion para seo"),
    };
  },
};

const SPECS: Record<Exclude<SourcePlatform, "pruva" | "hoja">, PlatformSpec> = {
  shopify: SHOPIFY,
  tiendanube: TIENDANUBE,
};

export function translatePlatformCsv(
  headers: readonly string[],
  rows: readonly string[][],
  rowNumbers: readonly number[],
): TranslatedCsv {
  const platform = detectPlatform(headers);
  if (platform === "hoja") return translateSheet(headers, rows, rowNumbers);
  if (platform === "pruva") {
    return {
      platform,
      headers: [...headers],
      rows: rows.map((r) => [...r]),
      rowNumbers: [...rowNumbers],
      ignored: [],
      imageOnlyRows: 0,
      productsWithImageUrl: 0,
    };
  }
  const spec = SPECS[platform];
  const position = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (!position.has(key)) position.set(key, i);
  });
  const present = new Set(position.keys());
  const out = Object.entries(spec.sources)
    .filter(([, from]) => from.some((h) => present.has(h)))
    .map(([column]) => column);
  const handleHeader = platform === "shopify" ? "handle" : "identificador de url";

  const getter =
    (row: readonly string[]): Getter =>
    (h) => {
      const at = position.get(h);
      return at === undefined ? "" : (row[at] ?? "").trim();
    };
  // Enlaces de fotos de cada producto, en el orden del archivo y sin repetir.
  const images = new Map<string, string[]>();
  for (const row of rows) {
    const get = getter(row);
    for (const h of spec.imageHeaders) {
      const url = get(h);
      if (!url) continue;
      const list = images.get(get(handleHeader)) ?? [];
      if (!list.includes(url)) list.push(url);
      images.set(get(handleHeader), list);
    }
  }

  const translated: string[][] = [];
  const numbers: number[] = [];
  const emitted = new Set<string>();
  let imageOnlyRows = 0;
  rows.forEach((row, i) => {
    const get = getter(row);
    if (spec.skip?.(get)) {
      imageOnlyRows += 1;
      return;
    }
    const values = spec.translate(get);
    const handle = get(handleHeader);
    // Las fotos van en la primera fila del producto (la que describe el producto).
    values.image_urls = emitted.has(handle) ? "" : (images.get(handle) ?? []).join("|");
    emitted.add(handle);
    translated.push(out.map((h) => values[h] ?? ""));
    numbers.push(rowNumbers[i] ?? i + 2);
  });

  const used = new Set([...Object.values(spec.sources).flat(), ...spec.imageHeaders]);
  return {
    platform,
    headers: out,
    rows: translated,
    rowNumbers: numbers,
    ignored: [...new Set(headers.filter((h) => h.trim() && !used.has(normalizeHeader(h))))],
    imageOnlyRows,
    productsWithImageUrl: [...images.values()].filter((l) => l.length > 0).length,
  };
}

// -----------------------------------------------------------------------------
// Hoja simple en español (plan 2026-11-05, fase C): una fila por producto, con
// encabezados como los escribe cualquiera («Producto», «Precio», «Existencias»…).
// El nombre corto (handle) se crea del nombre del producto: nadie tiene que
// inventarlo. Sirve igual para un archivo subido que para filas pegadas.
// -----------------------------------------------------------------------------

interface SheetColumn {
  column: string;
  /** Encabezados de origen (normalizados), en orden de preferencia. */
  from: readonly string[];
  convert?: (value: string, header: string) => string;
}

/** Enlaces separados por espacio, coma, punto y coma o «|», sin repetir. */
const urlList = (value: string): string =>
  [...new Set(value.split(/[\s,;|]+/).filter(Boolean))].join("|");

const SHEET_COLUMNS: readonly SheetColumn[] = [
  { column: "title", from: SHEET_TITLE },
  { column: "description", from: ["descripcion"] },
  { column: "price", from: SHEET_PRICE, convert: normalizeMoney },
  {
    column: "compare_at_price",
    from: ["precio anterior", "precio de lista", "precio tachado"],
    convert: normalizeMoney,
  },
  { column: "cost", from: ["costo"], convert: normalizeMoney },
  {
    column: "inventory_quantity",
    from: ["existencias", "inventario", "stock", "cantidad"],
    convert: quantity,
  },
  { column: "sku", from: ["sku", "codigo"] },
  { column: "barcode", from: ["codigo de barras"] },
  { column: "brand", from: ["marca"] },
  { column: "categories", from: ["categoria", "categorias"], convert: commaList },
  { column: "tags", from: ["etiquetas"], convert: commaList },
  {
    column: "image_urls",
    from: [
      "foto",
      "fotos",
      "imagen",
      "imagenes",
      "url de la foto",
      "url de las fotos",
      "enlace de la foto",
    ],
    convert: urlList,
  },
  {
    column: "weight_g",
    from: ["peso (g)", "peso en gramos", "peso (kg)"],
    convert: (value, header) => scaled(value, header === "peso (kg)" ? 1000 : 1),
  },
  {
    column: "status",
    from: ["estado", "publicado"],
    // «Publicado: sí/no» → activo o borrador; «Estado» se pasa tal cual (activo, borrador).
    convert: (value, header) => {
      if (header !== "publicado" || !value) return value;
      const answer = yesNo(value);
      return answer === "true" ? "active" : answer === "false" ? "draft" : value;
    },
  },
];

/** «Taza de barro azul» → «taza-de-barro-azul» (minúsculas, sin acentos ni signos). */
function slugify(text: string): string {
  return normalizeHeader(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

function translateSheet(
  headers: readonly string[],
  rows: readonly string[][],
  rowNumbers: readonly number[],
): TranslatedCsv {
  const position = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (!position.has(key)) position.set(key, i);
  });
  // Por columna de la tienda, el primer encabezado de la hoja que la trae.
  const used = SHEET_COLUMNS.flatMap((c) => {
    const header = c.from.find((h) => position.has(h));
    return header ? [{ spec: c, header, at: position.get(header)! }] : [];
  });
  const taken = new Set<string>();
  const handleFor = (title: string, rowNumber: number): string => {
    // Sin letras ni números en el nombre: «fila-N», también único dentro del archivo.
    const base = slugify(title) || `fila-${rowNumber}`;
    let handle = base;
    for (let n = 2; taken.has(handle); n += 1) handle = `${base}-${n}`;
    taken.add(handle);
    return handle;
  };

  const titleAt = used.find((u) => u.spec.column === "title")?.at;
  const translated: string[][] = [];
  const numbers: number[] = [];
  let withImages = 0;
  rows.forEach((row, i) => {
    const rowNumber = rowNumbers[i] ?? i + 2;
    const cells = used.map(({ spec, header, at }) => {
      const raw = (row[at] ?? "").trim();
      return spec.convert ? spec.convert(raw, header) : raw;
    });
    const title = titleAt === undefined ? "" : (row[titleAt] ?? "").trim();
    const imageIndex = used.findIndex((u) => u.spec.column === "image_urls");
    if (imageIndex >= 0 && cells[imageIndex]) withImages += 1;
    translated.push([handleFor(title, rowNumber), ...cells]);
    numbers.push(rowNumber);
  });

  const known = new Set(SHEET_COLUMNS.flatMap((c) => c.from));
  return {
    platform: "hoja",
    headers: ["handle", ...used.map((u) => u.spec.column)],
    rows: translated,
    rowNumbers: numbers,
    ignored: [...new Set(headers.filter((h) => h.trim() && !known.has(normalizeHeader(h))))],
    imageOnlyRows: 0,
    productsWithImageUrl: withImages,
  };
}
