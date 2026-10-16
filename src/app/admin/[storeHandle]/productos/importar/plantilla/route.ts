import { NextResponse } from "next/server";

import { toCsv } from "@/lib/csv";
import { ALL_IMPORT_HEADERS } from "@/server/imports/products";

/**
 * Plantilla de importación: solo encabezados, con todas las columnas que acepta la
 * importación (costo, ficha sanitaria y atributos incluidos; las que no uses se
 * pueden borrar). Nunca productos de ejemplo inventados.
 */
export function GET() {
  return new NextResponse(toCsv(ALL_IMPORT_HEADERS, []), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="plantilla-productos.csv"',
      "cache-control": "no-store",
    },
  });
}
