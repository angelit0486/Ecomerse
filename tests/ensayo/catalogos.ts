/**
 * Catálogos sintéticos para el ensayo de implementación (O10-01). Datos
 * inventados con forma realista por giro; ninguna tienda ni comercio real.
 * Deterministas: el mismo giro produce siempre las mismas filas.
 */

export type Giro = "ropa" | "hogar" | "abarrotes" | "suplementos";

export interface Catalogo {
  giro: Giro;
  /** Plantilla de tienda (Configuración → Plantilla por giro). */
  plantilla: RegExp;
  /** Nombre de la hoja del giro (Productos → Importar → plantilla?giro=). */
  hoja: Giro;
  tienda: string;
  encabezados: string[];
  filas: string[][];
  /** Un SKU por producto para nombrar su foto (subida en lote). */
  skuFoto: { sku: string; producto: string }[];
  /**
   * Errores típicos de captura inyectados a propósito en la primera subida,
   * para ensayar la corrección. `fila` es la del archivo (1 = encabezados).
   */
  errores: { fila: number; columna: string; malo: string }[];
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const money = (n: number) => n.toFixed(2);
const ean = (r: () => number) =>
  `750${Math.floor(r() * 1e9)
    .toString()
    .padStart(9, "0")}0`;

function ropa(): Catalogo {
  const r = rng(11);
  const tipos = [
    ["Playera", "Playeras", 249],
    ["Pantalón", "Pantalones", 599],
    ["Sudadera", "Sudaderas", 699],
    ["Gorra", "Accesorios", 299],
    ["Tenis", "Calzado", 1199],
  ] as const;
  const estilos = ["básica", "oversize", "clásica", "deportiva", "de algodón", "urbana"];
  const colores = ["Negro", "Blanco", "Azul marino"];
  const filas: string[][] = [];
  const skuFoto: Catalogo["skuFoto"] = [];
  for (let i = 0; i < 30; i++) {
    const [tipo, cat, base] = tipos[i % tipos.length]!;
    const nombre = `${tipo} ${estilos[i % estilos.length]} ${i + 1}`;
    const tallas =
      tipo === "Tenis" ? ["25", "26", "27"] : tipo === "Gorra" ? ["Única"] : ["CH", "M", "G"];
    const cols = colores.slice(0, tipo === "Gorra" ? 3 : 2);
    tallas.forEach((t, ti) =>
      cols.forEach((c, ci) => {
        const sku = `RP-${String(i + 1).padStart(3, "0")}-${ti}${ci}`;
        if (ti === 0 && ci === 0) skuFoto.push({ sku, producto: nombre });
        filas.push([
          nombre,
          t,
          c,
          money(base + (i % 3) * 50),
          i % 4 === 0 ? money(base + 200) : "",
          String(Math.floor(r() * 25)),
          sku,
          ean(r),
          pick(r, ["Norte Studio", "Ciudad Textil", "Paso Firme"]),
          cat,
          `${nombre} en ${c.toLowerCase()}. Tela de buena calidad, lavable en lavadora.`,
          "",
        ]);
      }),
    );
  }
  return {
    giro: "ropa",
    plantilla: /^Ropa/,
    hoja: "ropa",
    tienda: "Norte Studio (ensayo)",
    encabezados: [
      "Producto",
      "Talla",
      "Color",
      "Precio",
      "Precio anterior",
      "Existencias",
      "SKU",
      "Código de barras",
      "Marca",
      "Categoría",
      "Descripción",
      "Fotos",
    ],
    filas,
    skuFoto,
    errores: [
      { fila: 3, columna: "Precio", malo: "$ 249 pesos" },
      { fila: 10, columna: "Existencias", malo: "muchas" },
    ],
  };
}

function hogar(): Catalogo {
  const r = rng(22);
  const tipos = [
    ["Vela aromática", "Velas y aromas", 189, ["Chica", "Grande"]],
    ["Cojín bordado", "Textiles", 349, [""]],
    ["Taza de cerámica", "Cocina", 159, [""]],
    ["Maceta de barro", "Plantas y macetas", 229, ["15 cm", "25 cm"]],
    ["Cuadro decorativo", "Decoración", 499, [""]],
    ["Crema corporal", "Belleza", 219, ["250 ml", "500 ml"]],
    ["Caja de regalo", "Regalos", 399, [""]],
  ] as const;
  const filas: string[][] = [];
  const skuFoto: Catalogo["skuFoto"] = [];
  for (let i = 0; i < 70; i++) {
    const [tipo, cat, base, pres] = tipos[i % tipos.length]!;
    const nombre = `${tipo} ${["lavanda", "terracota", "nórdico", "artesanal", "jardín"][i % 5]} ${i + 1}`;
    pres.forEach((p, pi) => {
      const sku = `HG-${String(i + 1).padStart(3, "0")}-${pi}`;
      if (pi === 0) skuFoto.push({ sku, producto: nombre });
      filas.push([
        nombre,
        p,
        money(base + pi * 120),
        "",
        String(Math.floor(r() * 30)),
        sku,
        ean(r),
        String(200 + pi * 300),
        pick(r, ["Casa Lumbre", "Barro Vivo"]),
        cat,
        `${nombre}. Hecho en México.`,
        "",
      ]);
    });
  }
  return {
    giro: "hogar",
    plantilla: /^Hogar/,
    hoja: "hogar",
    tienda: "Casa Lumbre (ensayo)",
    encabezados: [
      "Producto",
      "Presentación",
      "Precio",
      "Precio anterior",
      "Existencias",
      "SKU",
      "Código de barras",
      "Peso (g)",
      "Marca",
      "Categoría",
      "Descripción",
      "Fotos",
    ],
    filas,
    skuFoto,
    errores: [{ fila: 5, columna: "SKU", malo: "HG-001-0" }],
  };
}

function abarrotes(): Catalogo {
  const r = rng(33);
  const tipos = [
    ["Frijol negro", "Despensa", 32, ["1 kg", "5 kg"]],
    ["Arroz", "Despensa", 28, ["1 kg"]],
    ["Aceite vegetal", "Despensa", 45, ["1 l"]],
    ["Refresco de cola", "Bebidas", 22, ["600 ml", "2 l"]],
    ["Agua natural", "Bebidas", 12, ["1 l", "5 l"]],
    ["Detergente en polvo", "Limpieza", 39, ["1 kg"]],
    ["Papas fritas", "Botanas", 18, ["45 g"]],
    ["Leche entera", "Lácteos", 29, ["1 l"]],
    ["Jabón de tocador", "Cuidado personal", 15, ["150 g"]],
  ] as const;
  const filas: string[][] = [];
  const skuFoto: Catalogo["skuFoto"] = [];
  for (let i = 0; i < 160; i++) {
    const [tipo, cat, base, pres] = tipos[i % tipos.length]!;
    const nombre = `${tipo} ${pick(r, ["La Lupita", "Don Chema", "El Valle", "Sol"])} ${i + 1}`;
    pres.forEach((p, pi) => {
      const sku = `AB-${String(i + 1).padStart(3, "0")}-${pi}`;
      if (pi === 0) skuFoto.push({ sku, producto: nombre });
      const precio = base * (pi === 0 ? 1 : 4.2);
      filas.push([
        nombre,
        p,
        money(precio),
        money(precio * 0.72),
        String(Math.floor(r() * 80)),
        sku,
        ean(r),
        pick(r, ["La Lupita", "Don Chema", "El Valle"]),
        cat,
        "",
        "",
      ]);
    });
  }
  return {
    giro: "abarrotes",
    plantilla: /^Abarrotes/,
    hoja: "abarrotes",
    tienda: "Abarrotes Lupita (ensayo)",
    encabezados: [
      "Producto",
      "Presentación",
      "Precio",
      "Costo",
      "Existencias",
      "SKU",
      "Código de barras",
      "Marca",
      "Categoría",
      "Descripción",
      "Fotos",
    ],
    filas,
    skuFoto,
    errores: [
      { fila: 7, columna: "Precio", malo: "" },
      { fila: 20, columna: "Costo", malo: "-5" },
    ],
  };
}

function suplementos(): Catalogo {
  const r = rng(44);
  const tipos = [
    ["Proteína whey", "Proteínas", 899],
    ["Creatina monohidratada", "Creatinas", 549],
    ["Multivitamínico", "Vitaminas", 329],
    ["Preentreno", "Preentrenos", 649],
    ["BCAA", "Aminoácidos", 499],
  ] as const;
  const filas: string[][] = [];
  const skuFoto: Catalogo["skuFoto"] = [];
  for (let i = 0; i < 40; i++) {
    const [tipo, cat, base] = tipos[i % tipos.length]!;
    const nombre = `${tipo} ${["Pro", "Max", "Fit", "Core"][i % 4]} ${i + 1}`;
    const sabores = tipo === "Multivitamínico" ? ["Natural"] : ["Vainilla", "Chocolate"];
    const tamanos = tipo === "Multivitamínico" ? ["60 cápsulas"] : ["1 kg", "2 kg"];
    sabores.forEach((s, si) =>
      tamanos.forEach((t, ti) => {
        const sku = `SP-${String(i + 1).padStart(3, "0")}-${si}${ti}`;
        if (si === 0 && ti === 0) skuFoto.push({ sku, producto: nombre });
        const precio = base * (ti === 0 ? 1 : 1.8);
        filas.push([
          nombre,
          s,
          t,
          money(precio),
          "",
          money(precio * 0.55),
          String(Math.floor(r() * 20)),
          sku,
          ean(r),
          pick(r, ["Atleta MX", "Forja"]),
          cat,
          `${nombre} sabor ${s.toLowerCase()}.`,
          "",
        ]);
      }),
    );
  }
  return {
    giro: "suplementos",
    plantilla: /^Suplementos/,
    hoja: "suplementos",
    tienda: "Forja Nutrición (ensayo)",
    encabezados: [
      "Producto",
      "Sabor",
      "Tamaño",
      "Precio",
      "Precio anterior",
      "Costo",
      "Existencias",
      "SKU",
      "Código de barras",
      "Marca",
      "Categoría",
      "Descripción",
      "Fotos",
    ],
    filas,
    skuFoto,
    errores: [{ fila: 4, columna: "Sabor", malo: "" }],
  };
}

export const CATALOGOS: Record<Giro, () => Catalogo> = { ropa, hogar, abarrotes, suplementos };

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV con BOM, como lo guarda Excel en español. `conErrores` aplica los errores inyectados. */
export function toSheetCsv(c: Catalogo, conErrores: boolean): string {
  const filas = c.filas.map((f) => [...f]);
  if (conErrores) {
    for (const e of c.errores) filas[e.fila - 2]![c.encabezados.indexOf(e.columna)] = e.malo;
  }
  return `\uFEFF${[c.encabezados, ...filas].map((f) => f.map(csvCell).join(",")).join("\n")}\n`;
}
