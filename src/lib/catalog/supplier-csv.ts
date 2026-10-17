import { CsvParseError, parseCsv } from "@/lib/csv-parse";
import { parseMoneyToCents } from "@/lib/money/format";

/**
 * Lista de disponibilidad de un proveedor en CSV (ADR-025 paso 2). Columnas:
 *   sku (obligatoria; el SKU de TU tienda), disponibilidad, cantidad,
 *   sku_proveedor, costo.
 * También en inglés (availability, quantity, supplier_sku, supplier_cost). Una
 * columna ausente conserva lo guardado; una celda vacía de sku_proveedor o costo
 * lo borra. Con cantidad y sin disponibilidad, se entiende «disponible».
 * Aquí solo se valida el formato; el SKU y los repetidos los valida la base.
 */
export type SupplierCsvField =
  "sku" | "availability" | "quantity" | "supplier_sku" | "unit_cost" | "duplicate" | "file";

export interface SupplierCsvRow {
  row: number;
  sku: string;
  availability: "available" | "limited" | "unavailable" | "unknown";
  quantity?: number;
  supplier_sku?: string | null;
  unit_cost?: number | null;
}

export interface SupplierCsvError {
  row: number;
  field: SupplierCsvField;
}

export const SUPPLIER_CSV_MAX_ROWS = 5000;

const HEADERS: Record<string, keyof Omit<SupplierCsvRow, "row">> = {
  sku: "sku",
  disponibilidad: "availability",
  availability: "availability",
  cantidad: "quantity",
  quantity: "quantity",
  sku_proveedor: "supplier_sku",
  supplier_sku: "supplier_sku",
  costo: "unit_cost",
  supplier_cost: "unit_cost",
  cost: "unit_cost",
};

const AVAILABILITY: Record<string, SupplierCsvRow["availability"]> = {
  available: "available",
  disponible: "available",
  si: "available",
  sí: "available",
  limited: "limited",
  limitado: "limited",
  limitada: "limited",
  unavailable: "unavailable",
  "no disponible": "unavailable",
  agotado: "unavailable",
  no: "unavailable",
  unknown: "unknown",
  desconocido: "unknown",
  "sin dato": "unknown",
};

export const SUPPLIER_CSV_MESSAGES: Record<SupplierCsvField, string> = {
  sku: "No hay una variante con ese SKU en tu tienda.",
  availability:
    "Disponibilidad: disponible, limitado, no disponible o desconocido (o escribe la cantidad).",
  quantity: "Cantidad: número entero de 0 a 1 000 000 (obligatoria si está disponible).",
  supplier_sku: "SKU del proveedor: hasta 100 caracteres.",
  unit_cost: "Costo: un monto como 450.00.",
  duplicate: "Este SKU ya aparece en una fila anterior.",
  file: "Revisa el archivo.",
};

export function parseSupplierCsv(
  text: string,
):
  | { ok: true; rows: SupplierCsvRow[] }
  | { ok: false; errors: SupplierCsvError[]; message?: string } {
  let parsed;
  try {
    parsed = parseCsv(text, { maxColumns: 30, maxFieldLength: 500 });
  } catch (error) {
    if (error instanceof CsvParseError) {
      return {
        ok: false,
        errors: [{ row: error.line, field: "file" }],
        message: `Línea ${error.line}: ${error.message}.`,
      };
    }
    throw error;
  }
  const columns = parsed.headers.map((h) => HEADERS[h.replace(/\s+/g, "_")]);
  if (!columns.includes("sku")) {
    return { ok: false, errors: [{ row: 1, field: "file" }], message: "Falta la columna «sku»." };
  }
  if (!columns.includes("availability") && !columns.includes("quantity")) {
    return {
      ok: false,
      errors: [{ row: 1, field: "file" }],
      message: "Incluye la columna «disponibilidad» o «cantidad».",
    };
  }
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      errors: [{ row: 1, field: "file" }],
      message: "El archivo no tiene filas.",
    };
  }
  if (parsed.rows.length > SUPPLIER_CSV_MAX_ROWS) {
    return {
      ok: false,
      errors: [{ row: 1, field: "file" }],
      message: `Máximo ${SUPPLIER_CSV_MAX_ROWS} filas por archivo.`,
    };
  }

  const rows: SupplierCsvRow[] = [];
  const errors: SupplierCsvError[] = [];
  parsed.rows.forEach((cells, i) => {
    const row = parsed.rowNumbers[i]!;
    const cell = (key: keyof Omit<SupplierCsvRow, "row">) => {
      const idx = columns.indexOf(key);
      return idx === -1 ? undefined : (cells[idx] ?? "").trim();
    };
    const sku = cell("sku") ?? "";
    if (!sku) errors.push({ row, field: "sku" });

    const qtyText = cell("quantity");
    let quantity: number | undefined;
    if (qtyText) {
      if (/^\d{1,7}$/.test(qtyText) && Number(qtyText) <= 1_000_000) quantity = Number(qtyText);
      else errors.push({ row, field: "quantity" });
    }

    const availText = (cell("availability") ?? "").toLowerCase().replace(/\s+/g, " ");
    let availability: SupplierCsvRow["availability"] | undefined;
    if (availText) {
      availability = AVAILABILITY[availText];
      if (!availability) errors.push({ row, field: "availability" });
    } else if (qtyText) {
      availability = "available";
    } else {
      // Fila sin disponibilidad ni cantidad: no se adivina. Tratarla como
      // «desconocido» dejaría en 0 las existencias del proveedor sin aviso.
      errors.push({ row, field: "availability" });
    }
    if ((availability === "available" || availability === "limited") && !qtyText) {
      errors.push({ row, field: "quantity" });
    }

    const out: SupplierCsvRow = { row, sku, availability: availability ?? "unknown" };
    if (quantity !== undefined) out.quantity = quantity;

    const supplierSku = cell("supplier_sku");
    if (supplierSku !== undefined) {
      if (supplierSku.length > 100) errors.push({ row, field: "supplier_sku" });
      out.supplier_sku = supplierSku || null;
    }
    const costText = cell("unit_cost");
    if (costText !== undefined) {
      if (!costText) out.unit_cost = null;
      else {
        const cents = parseMoneyToCents(costText.replace(/^(\d+),(\d{1,2})$/, "$1.$2"));
        if (cents === null) errors.push({ row, field: "unit_cost" });
        else out.unit_cost = cents;
      }
    }
    rows.push(out);
  });
  // Errores de formato y repetidos (mismo SKU sin distinguir mayúsculas).
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.sku.toUpperCase();
    if (key && seen.has(key)) errors.push({ row: r.row, field: "duplicate" });
    seen.add(key);
  }
  if (errors.length > 0) {
    return { ok: false, errors: errors.sort((a, b) => a.row - b.row) };
  }
  return { ok: true, rows };
}
