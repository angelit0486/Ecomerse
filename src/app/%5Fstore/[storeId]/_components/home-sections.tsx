import Link from "next/link";

import { mediaUrl, type HomeSectionData } from "@/server/storefront/catalog";
import { SafeHtml } from "@/ui/safe-html";

import { ProductGrid } from "./product-card";
import { ThemeLink } from "./theme-link";

/**
 * Secciones de la portada (GATE0 §20.2, F9-DESIGN §3 y §6). Todo es servidor y
 * texto escapado por React; el único HTML es `rich_text`, por `SafeHtml`. Los
 * enlaces se revalidan al mostrar (ThemeLink). Testimonios sin estrellas ni
 * JSON-LD de reseñas (D-F9-04).
 */
type Store = { currency: string; locale: string };

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
      <Heading className="text-3xl font-bold leading-tight sm:text-5xl">{section.heading}</Heading>
      {section.subheading ? <p className="text-base sm:text-lg">{section.subheading}</p> : null}
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
  return (
    <section className="relative isolate overflow-hidden rounded-[var(--sf-radius-card)]">
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada; LCP de la portada */}
      <img
        src={mediaUrl(section.image.path)}
        alt={section.image.alt ?? ""}
        width={section.image.width ?? 1600}
        height={section.image.height ?? 600}
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      {/* Velo fijo del tema: el texto blanco siempre se lee (F9-DESIGN §13 M5). */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/60" />
      <div className="px-6 py-16 text-white sm:px-12 sm:py-24">{content}</div>
    </section>
  );
}

export function HomeSections({
  sections,
  store,
  storeName,
}: {
  sections: HomeSectionData[];
  store: Store;
  storeName: string;
}) {
  const heroFirst = sections[0]?.type === "hero";
  // Sin hero arriba, las primeras imágenes de productos son el LCP: sin lazy.
  const eagerIndex = heroFirst ? -1 : sections.findIndex((s) => s.type === "featured_products");
  return (
    <div className="space-y-14">
      {/* Un solo h1: el del hero si va primero; si no, el nombre de la tienda. */}
      {heroFirst ? null : <h1 className="text-2xl font-semibold sm:text-3xl">{storeName}</h1>}
      {sections.map((section, index) => {
        const headingId = `sf-seccion-${index}`;
        switch (section.type) {
          case "hero":
            return <Hero key={section.id} section={section} headingLevel={index === 0 ? 1 : 2} />;
          case "featured_products": {
            const eager = index === eagerIndex ? 4 : 0;
            return (
              <section key={section.id} aria-labelledby={headingId} className="space-y-4">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id={headingId} className="text-xl font-semibold sm:text-2xl">
                    {section.title}
                  </h2>
                  {section.show_view_all ? (
                    <Link
                      href={viewAllHref(section.source)}
                      className="shrink-0 text-sm underline underline-offset-4"
                    >
                      Ver todos<span className="sr-only"> de {section.title}</span>
                    </Link>
                  ) : null}
                </div>
                <ProductGrid products={section.items} store={store} eager={eager} />
              </section>
            );
          }
          case "category_grid":
            return (
              <section key={section.id} aria-labelledby={headingId} className="space-y-4">
                <h2 id={headingId} className="text-xl font-semibold sm:text-2xl">
                  {section.title}
                </h2>
                <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {section.categories.map((category) => (
                    <li key={category.path}>
                      <Link
                        href={`/categoria/${category.path}`}
                        className="flex h-full flex-col gap-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-3 hover:bg-[var(--sf-surface)]"
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
                            className="aspect-square w-full rounded object-cover"
                          />
                        ) : null}
                        <span className="font-medium">{category.name}</span>
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
              <section key={section.id} aria-labelledby={headingId} className="space-y-4">
                <h2 id={headingId} className="text-xl font-semibold sm:text-2xl">
                  {section.title}
                </h2>
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
              <section key={section.id} aria-labelledby={headingId} className="space-y-4">
                <h2 id={headingId} className="text-xl font-semibold sm:text-2xl">
                  {section.title}
                </h2>
                <ul className="grid gap-4 sm:grid-cols-3">
                  {section.items.map((item, i) => (
                    <li key={i}>
                      <figure className="flex h-full flex-col gap-3 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-5">
                        <blockquote>
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
