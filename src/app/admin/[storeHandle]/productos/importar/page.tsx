import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { resumeQueue } from "@/server/jobs/run-now";
import { ALL_IMPORT_HEADERS } from "@/server/imports/products";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { linkButton, nativeControl } from "../styles";
import { JOB_STATUS } from "./labels";

export const metadata: Metadata = { title: "Importar productos" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ERRORS: Record<string, string> = {
  grande: "El archivo pesa más de 4 MB. Divídelo en varios archivos.",
  filas: "El archivo tiene más de 5 000 filas. Divídelo en varios archivos.",
  archivo: "Elige un archivo CSV.",
  vacio: "El archivo no tiene filas debajo del encabezado.",
  modo: "Elige qué hacer con los productos.",
  codificacion:
    "El archivo no está en UTF-8. En Excel usa «Guardar como → CSV UTF-8 (delimitado por comas)».",
  formato: "No pudimos leer el CSV",
  columnas: "Revisa los encabezados del archivo",
  permiso: "No pudimos validar el archivo. Revisa que tu rol permita importar productos.",
};

const FORMAT: Record<string, string> = {
  quote: "hay una comilla dentro de una celda sin comillas",
  unclosed: "unas comillas no se cierran",
  columns: "una fila tiene más de 100 columnas",
  field: "una celda tiene más de 20 000 caracteres",
};

/** El detalle llega como códigos de la ruta de subida; nunca se muestra texto libre de la URL. */
function errorDetail(code: string, raw: string): string | undefined {
  if (code === "formato") {
    const m = /^(\d{1,7}):(quote|unclosed|columns|field)$/.exec(raw);
    return m ? `fila ${m[1]}: ${FORMAT[m[2]!]}` : undefined;
  }
  if (code === "columnas") {
    const names = raw.split(",");
    const known = new Set<string>(ALL_IMPORT_HEADERS);
    return names.length > 0 && names.every((n) => known.has(n))
      ? `falta o está repetida: ${names.join(", ")}`
      : undefined;
  }
  return undefined;
}

/** Productos → Importar (F8-T04b, §26.1): subir CSV → vista previa → confirmar. */
export default async function ImportPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "imports.run")) notFound();
  const sp = await searchParams;
  const code = typeof sp.error === "string" && Object.hasOwn(ERRORS, sp.error) ? sp.error : null;
  const error = code ? ERRORS[code] : undefined;
  const detail = code && typeof sp.detalle === "string" ? errorDetail(code, sp.detalle) : undefined;
  const base = `/admin/${ctx.store.handle}/productos/importar`;

  const supabase = await createSupabaseServerClient();
  const { data: jobs } = await supabase
    .from("import_jobs")
    .select("id, file_name, mode, status, totals, created_at")
    .eq("store_id", ctx.store.id)
    .order("created_at", { ascending: false })
    .limit(10);
  // Importaciones confirmadas que esperan en la cola: se retoman al mirar la lista (D-LOTE-05).
  if (jobs?.some((j) => j.status === "committing")) resumeQueue("imports.list");

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={`/admin/${ctx.store.handle}/productos`} className="underline">
            Productos
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Importar productos</h1>
        <p className="text-sm text-fg-muted">
          Sube un CSV con una fila por variante. Primero verás una vista previa con los errores por
          fila; nada cambia en tu catálogo hasta que confirmes.
        </p>
        {hasPermission(ctx, "products.update") ? (
          <p className="text-sm">
            ¿Ya tienes los productos?{" "}
            <Link href={`${base}/imagenes`} className="underline">
              Sube sus fotos en lote
            </Link>{" "}
            (se asignan por SKU o nombre del archivo).
          </p>
        ) : null}
      </header>

      <ol className="space-y-4">
        <li className="space-y-2 rounded-md border border-border p-4">
          <h2 className="font-semibold">1. Descarga la plantilla</h2>
          <p className="text-sm text-fg-muted">
            Es una hoja con las columnas que entiende la tienda. Si ya tienes productos, exporta tu
            catálogo y edítalo: así cambias precios o existencias de muchos a la vez.
          </p>
          <p className="flex flex-wrap gap-2">
            <a href={`${base}/plantilla`} className={`${linkButton} h-11 border border-control`}>
              Descargar plantilla
            </a>
            {hasPermission(ctx, "exports.run") ? (
              <Link
                href={`/admin/${ctx.store.handle}/ajustes/exportar`}
                className={`${linkButton} h-11 border border-control`}
              >
                Exportar mis productos para editarlos
              </Link>
            ) : null}
          </p>
        </li>
        <li className="space-y-2 rounded-md border border-border p-4">
          <h2 className="font-semibold">2. Llénala en Excel o Google Sheets</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              Una fila por producto. Si tiene sabores o tallas, una fila por cada uno con el mismo{" "}
              <strong>nombre corto</strong> (columna <code>handle</code>, por ejemplo{" "}
              <code>proteina-whey-2lb</code>).
            </li>
            <li>
              Para crear un producto llena al menos <code>handle</code>, <code>title</code> (nombre)
              y <code>price</code> (precio, como <code>499.50</code>).
            </li>
            <li>
              Puedes escribir en español: <code>activo</code> o <code>borrador</code> en el estado,{" "}
              <code>sí</code> o <code>no</code>, y <code>suplemento</code> en el tipo regulado.
            </li>
            <li>Guárdala como «CSV UTF-8 (delimitado por comas)».</li>
          </ul>
        </li>
        <li className="space-y-3 rounded-md border border-border p-4">
          <h2 className="font-semibold">3. Súbela y revisa la vista previa</h2>
          {error ? (
            <p role="alert" className="rounded-md border border-danger p-3 text-sm">
              {error}
              {detail ? ` (${detail})` : ""}.
            </p>
          ) : null}
          <form
            method="post"
            action={`${base}/subir`}
            encType="multipart/form-data"
            className="space-y-4"
          >
            <div className="space-y-1">
              <label htmlFor="file" className="text-sm font-medium">
                Archivo CSV (UTF-8, hasta 4 MB y 5 000 filas)
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="block min-h-11 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mode" className="text-sm font-medium">
                Qué hacer
              </label>
              <select
                id="mode"
                name="mode"
                defaultValue="upsert"
                className={`${nativeControl} block h-11 w-full sm:w-auto`}
              >
                <option value="upsert">Crear los nuevos y actualizar los existentes</option>
                <option value="create_only">Solo crear productos nuevos</option>
                <option value="update_existing">Solo actualizar productos existentes</option>
              </select>
              <p className="text-[13px] text-fg-muted">
                Un producto existente se reconoce por su nombre corto y cada presentación por su SKU
                o sus opciones. Importar nunca borra productos.
              </p>
            </div>
            <button
              type="submit"
              className={`${linkButton} h-11 bg-accent text-accent-fg hover:bg-accent-hover`}
            >
              Validar archivo
            </button>
            <p className="text-[13px] text-fg-muted">
              Verás los errores por fila antes de que cambie nada en tu catálogo.
            </p>
          </form>
        </li>
      </ol>

      <details id="ayuda" className="rounded-md border border-border p-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Qué va en cada columna (detalle)
        </summary>
        <ul className="list-disc space-y-1 pl-5 text-fg-muted">
          <li>
            Solo <code>handle</code> es obligatorio. Las filas con el mismo handle son variantes del
            mismo producto; los datos del producto van en su primera fila. Para crear un producto
            hacen falta <code>title</code> y <code>price</code>.
          </li>
          <li>
            Una columna que no incluyas no cambia nada. Una celda vacía borra ese dato (descripción,
            marca, categorías, etiquetas, SEO, código de barras, precio de comparación, peso y
            medidas); el título, el precio y el estado vacíos se dejan como están.
          </li>
          <li>
            Precios como <code>199.50</code> (también <code>199,50</code>).{" "}
            <code>inventory_quantity</code> son las existencias físicas de la ubicación principal;
            vacía, no se tocan.
          </li>
          <li>
            Costo (opcional): <code>cost</code> es el costo unitario de la variante, con el mismo
            formato que el precio; vacía, se borra. Solo lo importan los roles que pueden ver
            costos.
          </li>
          <li>
            Categorías por nombre separadas con <code>|</code>; subcategorías con{" "}
            <code>Ropa &gt; Camisas</code>. Deben existir antes de importar.
          </li>
          <li>
            <code>status</code>: <code>active</code> publica (si el producto pasa la validación),{" "}
            <code>draft</code> lo deja en borrador y <code>archived</code> lo archiva.
          </li>
          <li>
            Ficha sanitaria (opcional): <code>regulatory_category</code> con{" "}
            <code>dietary_supplement</code> o <code>none</code> (vacía, sin cambios) y las columnas{" "}
            <code>regulatory_ingredients</code>, <code>regulatory_usage</code>,{" "}
            <code>regulatory_warnings</code>, <code>regulatory_net_content</code>… La tabla
            nutrimental va en <code>regulatory_nutrition</code> como{" "}
            <code>Omega 3|1000|mg; EPA|180|mg|10%</code>. Exporta tu catálogo para ver todas las
            columnas.
          </li>
          <li>
            Por presentación (opcional): <code>variant_net_content</code> (por ejemplo{" "}
            <code>2 kg</code>) y <code>variant_servings</code> (porciones, número entero). Vacías,
            se usa el dato de la ficha del producto.
          </li>
          <li>
            Atributos (opcional): <code>attributes</code> con las claves de Productos → Atributos,
            por ejemplo <code>objetivo:energia|fuerza; sabor:chocolate</code>. Vacía, el producto
            queda sin atributos.
          </li>
          <li>
            Las columnas que no son de la plantilla se ignoran y se avisan en la vista previa.
          </li>
        </ul>
      </details>

      {jobs && jobs.length > 0 ? (
        <section aria-labelledby="recientes" className="space-y-2">
          <h2 id="recientes" className="font-semibold">
            Importaciones recientes
          </h2>
          <ul className="divide-y divide-border text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap justify-between gap-3 py-2">
                <Link href={`${base}/${j.id}`} className="underline">
                  {j.file_name}
                </Link>
                <span className="text-fg-muted">
                  {JOB_STATUS[j.status] ?? j.status} ·{" "}
                  {new Date(j.created_at).toLocaleString("es-MX", { timeZone: ctx.store.timezone })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
