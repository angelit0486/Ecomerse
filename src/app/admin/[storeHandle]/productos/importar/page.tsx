import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { linkButton, nativeControl } from "../styles";
import { JOB_STATUS } from "./labels";

export const metadata: Metadata = { title: "Importar productos" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ERRORS: Record<string, string> = {
  grande: "El archivo pesa más de 5 MB. Divídelo en varios archivos.",
  filas: "El archivo tiene más de 5 000 filas. Divídelo en varios archivos.",
  archivo: "Elige un archivo CSV.",
  vacio: "El archivo no tiene filas debajo del encabezado.",
  modo: "Elige qué hacer con los productos.",
  codificacion:
    "El archivo no está en UTF-8. En Excel usa «Guardar como → CSV UTF-8 (delimitado por comas)».",
  formato: "No pudimos leer el CSV: revisa las comillas",
  columnas: "Las columnas no coinciden con la plantilla",
  permiso: "No pudimos validar el archivo. Revisa que tu rol permita importar productos.",
};

/** Productos → Importar (F8-T04b, §26.1): subir CSV → vista previa → confirmar. */
export default async function ImportPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "imports.run")) notFound();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const detail = typeof sp.detalle === "string" ? sp.detalle : undefined;
  const base = `/admin/${ctx.store.handle}/productos/importar`;

  const supabase = await createSupabaseServerClient();
  const { data: jobs } = await supabase
    .from("import_jobs")
    .select("id, file_name, mode, status, totals, created_at")
    .eq("store_id", ctx.store.id)
    .order("created_at", { ascending: false })
    .limit(10);

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
      </header>

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
        className="space-y-4 rounded-md border border-border p-4"
      >
        <div className="space-y-1">
          <label htmlFor="file" className="text-sm font-medium">
            Archivo CSV (UTF-8, hasta 5 MB y 5 000 filas)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="mode" className="text-sm font-medium">
            Qué hacer
          </label>
          <select id="mode" name="mode" defaultValue="upsert" className={`${nativeControl} block`}>
            <option value="upsert">Crear los nuevos y actualizar los existentes</option>
            <option value="create_only">Solo crear productos nuevos</option>
            <option value="update_existing">Solo actualizar productos existentes</option>
          </select>
          <p className="text-[13px] text-fg-muted">
            Un producto existente se reconoce por su handle. Al actualizarlo, sus variantes quedan
            como en el archivo: las que no aparezcan se retiran.
          </p>
        </div>
        <button
          type="submit"
          className={`${linkButton} bg-accent text-accent-fg hover:bg-accent-hover`}
        >
          Validar archivo
        </button>
      </form>

      <section aria-labelledby="ayuda" className="space-y-2 text-sm">
        <h2 id="ayuda" className="font-semibold">
          Cómo armar el archivo
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-fg-muted">
          <li>
            Obligatorios: <code>handle</code> y <code>price</code>; <code>title</code> en la primera
            fila de cada producto. Las filas con el mismo handle son variantes del mismo producto.
          </li>
          <li>
            Precios como <code>199.50</code> (también <code>199,50</code>).{" "}
            <code>inventory_quantity</code> son las existencias físicas de la ubicación principal.
          </li>
          <li>
            Categorías por nombre separadas con <code>|</code>; subcategorías con{" "}
            <code>Ropa &gt; Camisas</code>. Deben existir antes de importar.
          </li>
          <li>
            <code>status</code> = <code>active</code> publica el producto si pasa la validación de
            publicación; vacío o <code>draft</code> lo deja como borrador.
          </li>
        </ul>
        <p className="flex flex-wrap gap-2">
          <a href={`${base}/plantilla`} className={`${linkButton} border border-control`}>
            Descargar plantilla
          </a>
          {hasPermission(ctx, "exports.run") ? (
            <Link
              href={`/admin/${ctx.store.handle}/ajustes/exportar`}
              className={`${linkButton} border border-control`}
            >
              Exportar mis productos para editarlos
            </Link>
          ) : null}
        </p>
      </section>

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
