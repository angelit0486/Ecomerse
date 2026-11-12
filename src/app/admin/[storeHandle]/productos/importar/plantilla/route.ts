import { NextResponse, type NextRequest } from "next/server";

import { toCsv } from "@/lib/csv";
import { sheetTemplate } from "@/lib/imports/sheet-templates";
import { ALL_IMPORT_HEADERS } from "@/server/imports/products";

/**
 * Plantilla de importación: solo encabezados. Sin `giro`, todas las columnas que
 * acepta la importación (costo, ficha sanitaria y atributos incluidos; las que no
 * uses se pueden borrar). Con `?giro=ropa|hogar|abarrotes|suplementos`, la hoja
 * simple en español de ese giro (Orden 09). Nunca productos de ejemplo inventados.
 */
export function GET(request: NextRequest) {
  const template = sheetTemplate(request.nextUrl.searchParams.get("giro"));
  const headers = template ? template.headers : ALL_IMPORT_HEADERS;
  const name = template ? `hoja-${template.key}.csv` : "plantilla-productos.csv";
  // BOM: Excel en español abre el CSV en UTF-8 y respeta acentos y «ñ».
  return new NextResponse(`${template ? "\uFEFF" : ""}${toCsv(headers, [])}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
