import Link from "next/link";
import type { ReactNode } from "react";

import { mediaUrl, type HomeSectionData } from "@/server/storefront/catalog";
import { SafeHtml } from "@/ui/safe-html";

import { GoalChips } from "./goal-chips";
import { ProductGrid } from "./product-card";
import { ThemeLink } from "./theme-link";

/**
 * Secciones de la portada (GATE0 §20.2, F9-DESIGN §3 y §6). Todo es servidor y
 * texto escapado por React; el único HTML es `rich_text`, por `SafeHtml`. Los
 * enlaces se revalidan al mostrar (ThemeLink). Testimonios sin estrellas ni
 * JSON-LD de reseñas (D-F9-04).
 */
type Store = { currency: string; locale: string; launched_at?: string | null };

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-6 font-medium text-[var(--sf-btn-fg)]";

function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text
        .split(/\n{2,}|\n/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className={className}>
            {p}
          </p>
        ))}
    </>
  );
}

/**
 * Encabezado de sección editorial: regla fina, número de sección y título
 * grande (sin cajas). El número es decorativo (aria-hidden): el nombre accesible
 * del encabezado sigue siendo solo el título.
 */
function SectionHeading({
  id,
  number,
  title,
  action,
}: {
  id: string;
  number: number;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-t border-[var(--sf-fg)] pt-3">
      <h2 id={id} className="text-2xl font-semibold leading-none tracking-tight sm:text-4xl">
        <span
          aria-hidden="true"
          className="sf-text-font mr-3 inline-block align-top text-xs font-semibold tabular-nums tracking-normal text-[var(--sf-muted)] sm:text-sm"
        >
          {String(number).padStart(2, "0")}
        </span>
        {title}
      </h2>
      {action}
    </div>
  );
}

export function viewAllHref(
  source: Extract<HomeSectionData, { type: "featured_products" }>["source"],
) {
  switch (source.type) {
    case "newest":
      return "/productos?orden=newest";
    case "best_selling":
      return "/productos?orden=best_selling";
    case "category":
      return `/categoria/${source.path}`;
    case "brand":
      return `/marca/${encodeURIComponent(source.slug)}`;
    case "attribute_value":
      return `/productos?${encodeURIComponent(source.attribute)}=${encodeURIComponent(source.value)}`;
  }
}

function Hero({
  section,
  headingLevel,
}: {
  section: Extract<HomeSectionData, { type: "hero" }>;
  headingLevel: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const centered = section.align === "center";
  const content = (
    <div
      className={`flex max-w-2xl flex-col gap-4 ${centered ? "mx-auto items-center text-center" : "items-start"}`}
    >
      <Heading className="text-4xl font-bold leading-[1.02] tracking-tight text-balance sm:text-6xl">
        {section.heading}
      </Heading>
      {section.subheading ? (
        <p className="max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
          {section.subheading}
        </p>
      ) : null}
      {section.cta ? (
        <ThemeLink href={section.cta.link} className={BUTTON}>
          {section.cta.label}
        </ThemeLink>
      ) : null}
    </div>
  );
  if (!section.image) {
    return (
      <section className="rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] px-6 py-12 sm:px-12 sm:py-16">
        {content}
      </section>
    );
  }
  // Móvil (revisión de conversión, A5): la imagen va arriba como banda y el texto
  // debajo sobre el fondo del tema; recortada detrás del texto a 375 px parecía
  // una losa rota. Desde `sm`, la imagen de fondo con velo.
  return (
    <section className="overflow-hidden rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] sm:relative sm:isolate sm:bg-transparent">
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada; LCP de la portada */}
      <img
        src={mediaUrl(section.image.path)}
        alt={section.image.alt ?? ""}
        width={section.image.width ?? 1600}
        height={section.image.height ?? 600}
        fetchPriority="high"
        decoding="async"
        className="block aspect-[16/9] w-full object-cover sm:absolute sm:inset-0 sm:-z-10 sm:aspect-auto sm:h-full"
      />
      {/* Velo fijo del tema: el texto blanco siempre se lee (F9-DESIGN §13 M5). */}
      {/* Alineado a la izquierda, el velo se degrada hacia la derecha para dejar ver la
          imagen; bajo el texto mantiene la misma opacidad (contraste garantizado). */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 -z-10 hidden sm:block ${centered ? "bg-black/60" : "bg-gradient-to-r from-black/75 from-45% via-black/60 via-65% to-black/20"}`}
      />
      <div className="px-5 py-6 sm:px-12 sm:py-24 sm:text-white">{content}</div>
    </section>
  );
}

export function HomeSections({
  sections,
  store,
  storeName,
  goals = [],
  trust = null,
}: {
  /** Franja de confianza con datos reales de la tienda, bajo los objetivos. */
  trust?: ReactNode;
  sections: HomeSectionData[];
  store: Store;
  storeName: string;
  /** Objetivos con productos: chips bajo el hero (o bajo el título, sin hero). */
  goals?: { key: string; label: string }[];
}) {
  const heroFirst = sections[0]?.type === "hero";
  // Sin hero arriba, las primeras imágenes de productos son el LCP: sin lazy.
  const eagerIndex = heroFirst ? -1 : sections.findIndex((s) => s.type === "featured_products");
  // Numeración de las secciones con título (01, 02…), en el orden en que se ven.
  const numbered = new Map<number, number>();
  sections.forEach((section, index) => {
    if (
      ["featured_products", "category_grid", "brand_logos", "testimonials"].includes(section.type)
    ) {
      numbered.set(index, numbered.size + 1);
    }
  });
  return (
    <div className="space-y-16 sm:space-y-24">
      {/* Un solo h1: el del hero si va primero; si no, el nombre de la tienda. */}
      {heroFirst ? null : (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold sm:text-3xl">{storeName}</h1>
          <GoalChips goals={goals} />
          {trust}
        </div>
      )}
      {sections.map((section, index) => {
        const headingId = `sf-seccion-${index}`;
        switch (section.type) {
          case "hero":
            return index === 0 ? (
              <div key={section.id} className="space-y-4">
                <Hero section={section} headingLevel={1} />
                <GoalChips goals={goals} />
                {trust}
              </div>
            ) : (
              <Hero key={section.id} section={section} headingLevel={2} />
            );
          case "featured_products": {
            const eager = index === eagerIndex ? 4 : 0;
            return (
              <section key={section.id} aria-labelledby={headingId} className="space-y-6">
                <SectionHeading
                  id={headingId}
                  number={numbered.get(index) ?? 0}
                  title={section.title}
                  action={
                    section.show_view_all ? (
                      <Link
                        href={viewAllHref(section.source)}
                        className="shrink-0 pb-0.5 text-sm font-medium underline decoration-1 underline-offset-4 hover:decoration-2"
                      >
                        Ver todos<span className="sr-only"> de {section.title}</span>
                      </Link>
                    ) : null
                  }
                />
                <ProductGrid products={section.items} store={store} eager={eager} carousel />
              </section>
            );
          }
          case "category_grid":
            // Índice tipográfico: nombres grandes en renglones con regla fina. Con
            // imágenes de categoría, la miniatura acompaña al nombre.
            return (
              <section key={section.id} aria-labelledby={headingId} className="space-y-2">
                <SectionHeading
                  id={headingId}
                  number={numbered.get(index) ?? 0}
                  title={section.title}
                />
                <ul className="grid sm:grid-cols-2 sm:gap-x-10">
                  {section.categories.map((category) => (
                    <li key={category.path} className="border-b border-[var(--sf-border)]">
                      <Link
                        href={`/categoria/${category.path}`}
                        className="group flex min-h-16 items-center gap-4 py-3"
                      >
                        {category.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
                          <img
                            src={mediaUrl(category.image.path)}
                            alt=""
                            width={category.image.width ?? 320}
                            height={category.image.height ?? 320}
                            loading="lazy"
                            decoding="async"
                            className="h-12 w-12 shrink-0 rounded-[var(--sf-radius-control)] object-cover"
                          />
                        ) : null}
                        <span className="text-xl font-medium tracking-tight decoration-1 underline-offset-[6px] group-hover:underline sm:text-2xl">
                          {category.name}
                        </span>
                        <span
                          aria-hidden="true"
                          className="ml-auto text-lg text-[var(--sf-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--sf-fg)]"
                        >
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          case "promo_banner":
            return (
              <section
                key={section.id}
                aria-label={section.heading ?? "Promoción"}
                className="relative isolate overflow-hidden rounded-[var(--sf-radius-card)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada */}
                <img
                  src={mediaUrl(section.image.path)}
                  alt={section.image.alt ?? ""}
                  width={section.image.width ?? 1600}
                  height={section.image.height ?? 500}
                  loading="lazy"
                  decoding="async"
                  className={
                    section.heading || section.text
                      ? "absolute inset-0 -z-10 h-full w-full object-cover"
                      : "h-auto w-full"
                  }
                />
                {section.heading || section.text ? (
                  <>
                    <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/60" />
                    <div className="flex flex-col items-start gap-3 px-6 py-12 text-white sm:px-12">
                      {section.heading ? (
                        <h2 className="text-2xl font-bold sm:text-3xl">{section.heading}</h2>
                      ) : null}
                      {section.text ? <p>{section.text}</p> : null}
                      {section.cta ? (
                        <ThemeLink href={section.cta.link} className={BUTTON}>
                          {section.cta.label}
                        </ThemeLink>
                      ) : null}
                    </div>
                  </>
                ) : section.cta ? (
                  <div className="p-4">
                    <ThemeLink href={section.cta.link} className={BUTTON}>
                      {section.cta.label}
                    </ThemeLink>
                  </div>
                ) : null}
              </section>
            );
          case "image_with_text":
            return (
              <section
                key={section.id}
                aria-labelledby={headingId}
                className="grid items-center gap-6 sm:grid-cols-2 sm:gap-10"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada */}
                <img
                  src={mediaUrl(section.image.path)}
                  alt={section.image.alt ?? ""}
                  width={section.image.width ?? 800}
                  height={section.image.height ?? 600}
                  loading="lazy"
                  decoding="async"
                  className={`w-full rounded-[var(--sf-radius-card)] object-cover ${section.image_position === "right" ? "sm:order-last" : ""}`}
                />
                <div className="space-y-3">
                  <h2 id={headingId} className="text-xl font-semibold sm:text-2xl">
                    {section.heading}
                  </h2>
                  <Paragraphs text={section.body} className="text-[var(--sf-muted)]" />
                  {section.cta ? (
                    <ThemeLink href={section.cta.link} className={BUTTON}>
                      {section.cta.label}
                    </ThemeLink>
                  ) : null}
                </div>
              </section>
            );
          case "brand_logos":
            return (
              <section key={section.id} aria-labelledby={headingId} className="space-y-6">
                <SectionHeading
                  id={headingId}
                  number={numbered.get(index) ?? 0}
                  title={section.title}
                />
                <ul className="grid grid-cols-3 items-center gap-6 sm:grid-cols-6">
                  {section.brands.map((brand) => (
                    <li key={brand.slug}>
                      <Link
                        href={`/marca/${encodeURIComponent(brand.slug)}`}
                        className="flex min-h-16 items-center justify-center rounded-[var(--sf-radius-control)] p-2 hover:bg-[var(--sf-surface)]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- logo re-codificado */}
                        <img
                          src={mediaUrl(brand.logo.path)}
                          alt={brand.name}
                          width={brand.logo.width ?? 160}
                          height={brand.logo.height ?? 64}
                          loading="lazy"
                          decoding="async"
                          className="max-h-12 w-auto object-contain"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          case "testimonials":
            return (
              <section key={section.id} aria-labelledby={headingId} className="space-y-6">
                <SectionHeading
                  id={headingId}
                  number={numbered.get(index) ?? 0}
                  title={section.title}
                />
                <ul className="grid gap-8 sm:grid-cols-3 sm:gap-10">
                  {section.items.map((item, i) => (
                    <li key={i}>
                      <figure className="flex h-full flex-col gap-4 border-l-2 border-[var(--sf-fg)] pl-5">
                        <blockquote className="text-lg leading-relaxed">
                          <Paragraphs text={item.quote} />
                        </blockquote>
                        <figcaption className="mt-auto text-sm text-[var(--sf-muted)]">
                          <span className="font-medium text-[var(--sf-fg)]">{item.author}</span>
                          {item.detail ? ` · ${item.detail}` : null}
                        </figcaption>
                      </figure>
                    </li>
                  ))}
                </ul>
              </section>
            );
          case "rich_text":
            return (
              <section
                key={section.id}
                aria-labelledby={section.heading ? headingId : undefined}
                aria-label={section.heading ? undefined : "Información"}
                className="max-w-3xl space-y-3"
              >
                {section.heading ? (
                  <h2 id={headingId} className="text-xl font-semibold sm:text-2xl">
                    {section.heading}
                  </h2>
                ) : null}
                <SafeHtml html={section.html} className="sf-prose" />
              </section>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
