/**
 * Atributos filtrables (R-T04, ADR-022): lo que comparten el panel y la tienda
 * pública. La base valida todo otra vez (catalog_save_attribute y
 * storefront.list_products / list_facets).
 */

/** Parámetros de los listados que nunca son atributos (misma lista que la base). */
export const RESERVED_LISTING_PARAMS: readonly string[] = [
  "q",
  "orden",
  "disponible",
  "desde",
  "marca",
  "categoria",
  "precio",
  "pagina",
  "vista",
  "filtro",
  "filtros",
  "buscar",
];

const ATTRIBUTE_KEY_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VALUE_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * Clave convencional del atributo «Objetivo» (menú «Objetivos», portada,
 * ficha y búsqueda sin resultados enlazan a `?objetivo=…`).
 */
export const GOAL_KEY = "objetivo";

export const MAX_SELECTED_ATTRIBUTES = 10;
export const MAX_SELECTED_VALUES = 20;
export const MAX_ATTRIBUTE_VALUES = 50;
export const MAX_NAME_LENGTH = 60;

/** Filtros elegidos: clave del atributo → claves de sus valores (ordenadas). */
export type AttributeSelection = Record<string, string[]>;

/**
 * Filtros de atributos de la URL (`?objetivo=energia&objetivo=fuerza`). Lo que
 * no tiene forma de filtro se ignora (un `fbclid`, por ejemplo); la base ignora
 * además las claves que la tienda no tiene. Máximo 10 atributos y 20 valores.
 */
export function parseAttributeParams(
  params: Record<string, string | string[] | undefined>,
): AttributeSelection {
  const entries: [string, string[]][] = [];
  for (const key of Object.keys(params).sort()) {
    if (entries.length >= MAX_SELECTED_ATTRIBUTES) break;
    if (key.length > 40 || !ATTRIBUTE_KEY_RE.test(key) || RESERVED_LISTING_PARAMS.includes(key)) {
      continue;
    }
    const raw = params[key];
    const values = [
      ...new Set(
        (Array.isArray(raw) ? raw : [raw]).filter(
          (v): v is string => typeof v === "string" && v.length <= 60 && VALUE_KEY_RE.test(v),
        ),
      ),
    ]
      .sort()
      .slice(0, MAX_SELECTED_VALUES);
    if (values.length > 0) entries.push([key, values]);
  }
  return Object.fromEntries(entries);
}

/** Marcas elegidas en la URL (`?marca=a&marca=b`, F9-T04): slugs válidos, máximo 20. */
export function parseBrandParams(params: Record<string, string | string[] | undefined>): string[] {
  const raw = params.marca;
  return [
    ...new Set(
      (Array.isArray(raw) ? raw : [raw]).filter(
        (v): v is string => typeof v === "string" && v.length <= 120 && VALUE_KEY_RE.test(v),
      ),
    ),
  ]
    .sort()
    .slice(0, MAX_SELECTED_VALUES);
}

/** Pares (clave, valor) para enlaces y campos ocultos de formularios GET. */
export function selectionPairs(selection: AttributeSelection): [string, string][] {
  return Object.entries(selection).flatMap(([key, values]) =>
    values.map((value) => [key, value] as [string, string]),
  );
}

export function hasSelection(selection: AttributeSelection): boolean {
  return Object.keys(selection).length > 0;
}

export interface AttributeFormInput {
  id?: string;
  name: string;
  is_filterable: boolean;
  values: { id?: string; label: string }[];
}

export type AttributeFormResult =
  | { ok: true; attribute: AttributeFormInput }
  | { ok: false; fields: Partial<Record<"name" | "values" | "id", string>> };

/**
 * Formulario de un atributo del panel. Un renglón nuevo vacío se ignora; uno
 * existente sin nombre es un error (para quitarlo está el botón «Quitar»).
 */
export function normalizeAttributeForm(raw: {
  id: string;
  name: string;
  filterable: boolean;
  values: { id: string; label: string }[];
}): AttributeFormResult {
  const fields: Partial<Record<"name" | "values" | "id", string>> = {};
  const id = raw.id.trim();
  if (id && !UUID_RE.test(id)) fields.id = "invalid";
  const name = raw.name.trim();
  if (!name || name.length > MAX_NAME_LENGTH || CONTROL_RE.test(name)) {
    fields.name = `Escribe un nombre de hasta ${MAX_NAME_LENGTH} caracteres.`;
  }
  const values: { id?: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const row of raw.values) {
    const label = row.label.trim();
    const valueId = row.id.trim();
    if (!label && !valueId) continue;
    const duplicate = seen.has(label.toLowerCase());
    if (
      !label ||
      label.length > MAX_NAME_LENGTH ||
      CONTROL_RE.test(label) ||
      !/[\p{L}\p{N}]/u.test(label) ||
      (valueId && !UUID_RE.test(valueId)) ||
      duplicate
    ) {
      fields.values = duplicate
        ? `«${label}» está repetido.`
        : `Cada valor necesita un nombre de hasta ${MAX_NAME_LENGTH} caracteres, con letras o números.`;
      break;
    }
    seen.add(label.toLowerCase());
    values.push(valueId ? { id: valueId, label } : { label });
  }
  if (!fields.values && (values.length === 0 || values.length > MAX_ATTRIBUTE_VALUES)) {
    fields.values = `Agrega entre 1 y ${MAX_ATTRIBUTE_VALUES} valores.`;
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    attribute: { ...(id ? { id } : {}), name, is_filterable: raw.filterable, values },
  };
}
