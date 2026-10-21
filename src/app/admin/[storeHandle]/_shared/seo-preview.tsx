/**
 * Cómo se ve una página en Google y al compartirla (ADR-034 §1). Es una
 * aproximación: Google puede recortar o cambiar el texto. Los cortes imitan los
 * suyos (≈ 60 caracteres de título y 155 de descripción).
 */
function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : text;
}

export function SeoPreview({
  title,
  description,
  url,
  imageUrl,
  headingLevel = 3,
}: {
  title: string;
  description: string;
  url: string;
  imageUrl: string | null;
  /** Nivel del título según dónde se muestre, para no saltar niveles (axe heading-order). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="vista-buscadores" className="space-y-3">
      <Heading id="vista-buscadores" className="text-sm font-semibold">
        Así se vería
      </Heading>
      {/* min-w-0: sin él, la URL de una sola línea ensancha la columna en el celular. */}
      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <figure className="space-y-1 rounded-md border border-border p-4">
          <figcaption className="text-[12px] text-fg-muted">En Google</figcaption>
          <p className="truncate text-[13px] text-fg-muted">{url}</p>
          <p className="break-words text-lg leading-snug text-[#1a0dab]">{cut(title, 60)}</p>
          <p className="text-sm text-fg-muted">
            {description
              ? cut(description, 155)
              : "Sin descripción: Google elegirá un texto de la página."}
          </p>
        </figure>
        <figure className="overflow-hidden rounded-md border border-border">
          <figcaption className="sr-only">Al compartir en redes</figcaption>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen ya re-codificada
            <img src={imageUrl} alt="" className="aspect-[1200/630] w-full object-cover" />
          ) : (
            <div className="flex aspect-[1200/630] items-center justify-center bg-canvas text-sm text-fg-muted">
              Sin imagen: se usará tu logo
            </div>
          )}
          <div className="space-y-0.5 border-t border-border p-3">
            <p className="text-[12px] uppercase text-fg-muted">
              {url.replace(/^https?:\/\//, "").split("/")[0]}
            </p>
            <p className="break-words font-semibold leading-snug">{cut(title, 70)}</p>
            {description ? <p className="text-sm text-fg-muted">{cut(description, 110)}</p> : null}
          </div>
        </figure>
      </div>
    </section>
  );
}
