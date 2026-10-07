import { NextResponse } from "next/server";

import { toCsv } from "@/lib/csv";
import { IMPORT_HEADERS } from "@/server/imports/products";

/** Plantilla de importación: solo encabezados. Nunca productos de ejemplo inventados. */
export function GET() {
  return new NextResponse(toCsv(IMPORT_HEADERS, []), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="plantilla-productos.csv"',
      "cache-control": "no-store",
    },
  });
}
