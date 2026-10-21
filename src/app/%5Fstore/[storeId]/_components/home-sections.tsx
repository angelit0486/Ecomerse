import Link from "next/link";
import type { ReactNode } from "react";

import { getCategoryCovers, mediaUrl, type HomeSectionData } from "@/server/storefront/catalog";
import { SafeHtml } from "@/ui/safe-html";

import { GoalTiles, type GoalTile } from "./goal-chips";
import {
  BenefitsBlock,
  ContactBlock,
  FaqBlock,
  GoalsBlock,
  ReviewsBlock,
  VideoBlock,
} from "./home-blocks";
import { ProductGrid } from "./rated-product-grid";
import { ThemeLink } from "./theme-link";

/**
 * Secciones de la portada (GATE0 §20.2, F9-DESIGN §3 y §6; rediseño A+B). Todo
 * es servidor y texto escapado por React; el único HTML es `rich_text`, por
 * `SafeHtml`. Los enlaces se revalidan al mostrar (ThemeLink). Testimonios sin
 * estrellas ni JSON-LD de reseñas (D-F9-04).
 */
type Store = { id: string; currency: string; locale: string; launched_at?: string | null };

const BUTTON =
  "inline-flex min-h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-6 font-bold text-[var(--sf-btn-fg)]";

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

/** Título de sección a la izquierda y, si hay, «Ver todos» a la derecha (rediseño A+B). */
export function SectionHeading({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 id={id} className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
        {title}
      </h2>
      {action}
    </div>
  );
}

/** «Ver todos» de una sección: el nombre accesible dice de qué. */
export function ViewAll({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 pb-1 text-sm font-semibold text-[var(--sf-link)] underline-offset-4 hover:underline"
    >
      Ver todos<span className="sr-only"> de {title}</span>
    </Link>
  );
}

export function viewAllHref(
  source: Extract<HomeSectionData, { type: "featured_products" }>["source"],
): string | null {
  switch (source.type) {
    case "manual":
      // Elegidos a mano: no hay un listado con exactamente esos productos.
      return null;
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

/**
 * Hero de anaquel (rediseño A+B): tarjeta en el color de compra con el texto que
 * ese color ya garantiza (≥ 4.5:1) y el botón invertido (mismo par). Con imagen,
 * va a la derecha en escritorio y abajo en móvil.
 */
function Hero({
  section,
  headingLevel,
}: {
  section: Extract<HomeSectionData, { type: "hero" }>;
  headingLevel: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const centered = section.align === "center";
  const image = section.image;
  return (
    <section
      className={`grid overflow-hidden rounded-[var(--sf-radius-panel)] bg-[var(--sf-primary)] text-[var(--sf-on-primary)] [&_:focus-visible]:outline-[var(--sf-on-primary)] ${
        image && !centered ? "sm:grid-cols-[1.1fr_1fr] sm:items-center" : ""
      }`}
    >
      <div
        className={`flex flex-col gap-4 px-5 pt-7 sm:px-12 sm:py-14 ${image ? "pb-2" : "pb-7"} ${centered ? "items-center text-center" : "items-start"}`}
      >
        <Heading className="max-w-2xl text-[2.125rem] font-extrabold leading-[1.02] tracking-tight text-balance sm:text-5xl lg:text-6xl">
          {section.heading}
        </Heading>
        {section.subheading ? (
          <p className="max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            {section.subheading}
          </p>
        ) : null}
        {section.cta ? (
          <ThemeLink
            href={section.cta.link}
            className="mt-1 inline-flex min-h-12 items-center justify-center rounded-[var(--sf-radius-btn)] bg-[var(--sf-on-primary)] px-7 font-bold text-[var(--sf-primary)]"
          >
            {section.cta.label}
          </ThemeLink>
        ) : null}
      </div>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada; LCP de la portada
        <img
          src={mediaUrl(image.path)}
          alt={image.alt ?? ""}
          width={image.width ?? 1600}
          height={image.height ?? 640}
          fetchPriority="high"
          decoding="async"
          className={`block w-full object-cover ${
            centered ? "aspect-[16/7]" : "aspect-[16/9] sm:aspect-auto sm:h-full sm:min-h-80"
          }`}
        />
      ) : null}
    </section>
  );
}

/**
 * «Compra por categoría» en círculos (rediseño A+B). Sin imagen propia, la foto
 * del producto más vendido de la categoría; sin productos, la inicial.
 */
async function CategoryCircles({
  section,
  store,
  headingId,
}: {
  section: Extract<HomeSectionData, { type: "category_grid" }>;
  store: Store;
  headingId: string;
}) {
  const covers = await getCategoryCovers(
    store.id,
    section.categories.filter((c) => !c.image).map((c) => c.path),
  );
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <SectionHeading id={headingId} title={section.title} />
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {section.categories.map((category) => {
          const image = category.image ?? covers[category.path] ?? null;
          return (
            <li key={category.path} className="w-[5.5rem] shrink-0 sm:w-auto">
              <Link
                href={`/categoria/${category.path}`}
                className="group flex flex-col items-center gap-2 text-center"
              >
                <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-full bg-[var(--sf-surface)] ring-1 ring-[var(--sf-border)] motion-safe:transition-shadow group-hover:ring-2 group-hover:ring-[var(--sf-primary)]">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
                    <img
                      src={mediaUrl(image.path)}
                      alt=""
                      width={image.width ?? 320}
                      height={image.height ?? 320}
                      loading="lazy"
                      decoding="async"
                      className={`h-full w-full [mix-blend-mode:var(--sf-photo-blend,multiply)] ${category.image ? "object-cover" : "object-contain p-1.5"}`}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="text-2xl font-extrabold text-[var(--sf-link)] [font-family:var(--sf-font-heading),system-ui,sans-serif]"
                    >
                      {category.name.slice(0, 1)}
                    </span>
                  )}
                </span>
                <span className="text-sm font-semibold leading-tight text-balance">
                  {category.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Visibilidad por dispositivo (ADR-034): se oculta con CSS, el corte es `sm` (640 px). */
function VisibleOn({
  visibility,
  children,
}: {
  visibility: HomeSectionData["visibility"];
  children: ReactNode;
}) {
  if (!visibility || visibility === "all") return children;
  return <div className={visibility === "mobile" ? "sm:hidden" : "max-sm:hidden"}>{children}</div>;
}

export function HomeSections({
  sections,
  store,
  storeName,
  goals = [],
  trust = null,
  contact = {},
  asPage = false,
}: {
  /** En una página de contenido (ADR-034 §3): el h1 es el título de la página. */
  asPage?: boolean;
  /** Contacto del tema, para el bloque «Contacto y ubicación». */
  contact?: { address?: string; hours?: string; whatsapp?: string };
  /** Franja de confianza con datos reales de la tienda, bajo los objetivos. */
  trust?: ReactNode;
  sections: HomeSectionData[];
  store: Store;
  storeName: string;
  /** Objetivos con productos: bloques de color bajo el hero (o bajo el título, sin hero). */
  goals?: GoalTile[];
}) {
  const heroFirst = !asPage && sections[0]?.type === "hero";
  // Sin hero arriba, las primeras imágenes de productos son el LCP: sin lazy.
  const eagerIndex = heroFirst ? -1 : sections.findIndex((s) => s.type === "featured_products");
  return (
    <div className="flex flex-col gap-[var(--sf-section-gap)] sm:gap-[var(--sf-section-gap-lg)]">
      {/* Un solo h1: el del hero si va primero; si no, el nombre de la tienda. */}
      {heroFirst || asPage ? null : (
        <div className="space-y-8">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{storeName}</h1>
          <GoalTiles goals={goals} />
          {trust}
        </div>
      )}
      {sections.map((section, index) => (
        <VisibleOn key={section.id} visibility={section.visibility}>
          {renderSection(section, index)}
        </VisibleOn>
      ))}
    </div>
  );

  function renderSection(section: HomeSectionData, index: number): ReactNode {
    const headingId = `sf-seccion-${index}`;
    switch (section.type) {
      case "hero":
        return index === 0 && !asPage ? (
          <div
            key={section.id}
            className="flex flex-col gap-[var(--sf-section-gap)] sm:gap-[var(--sf-section-gap-lg)]"
          >
            <Hero section={section} headingLevel={1} />
            <GoalTiles goals={goals} />
            {trust}
          </div>
        ) : (
          <Hero key={section.id} section={section} headingLevel={2} />
        );
      case "featured_products": {
        const eager = index === eagerIndex ? 4 : 0;
        const href = section.show_view_all ? viewAllHref(section.source) : null;
        return (
          <section key={section.id} aria-labelledby={headingId} className="space-y-4">
            <SectionHeading
              id={headingId}
              title={section.title}
              action={href ? <ViewAll href={href} title={section.title} /> : null}
            />
            <ProductGrid
              products={section.items}
              store={store}
              eager={eager}
              carousel={section.layout === "carousel" ? "always" : true}
            />
          </section>
        );
      }
      case "category_grid":
        return (
          <CategoryCircles key={section.id} section={section} store={store} headingId={headingId} />
        );
      case "promo_banner":
        return (
          <section
            key={section.id}
            aria-label={section.heading ?? "Promoción"}
            className="relative isolate overflow-hidden rounded-[var(--sf-radius-panel)]"
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
                {/* Velo fijo: el texto blanco siempre se lee (F9-DESIGN §13 M5). */}
                <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/60" />
                <div className="flex flex-col items-start gap-3 px-6 py-12 text-white sm:px-12 [&_:focus-visible]:outline-white">
                  {section.heading ? (
                    <h2 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
                      {section.heading}
                    </h2>
                  ) : null}
                  {section.text ? <p className="max-w-xl">{section.text}</p> : null}
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
        // Tarjeta de guía (rediseño A+B): borde marcado, texto y foto lado a lado.
        return (
          <section
            key={section.id}
            aria-labelledby={headingId}
            className="grid items-center gap-5 overflow-hidden rounded-[var(--sf-radius-panel)] border-2 border-[var(--sf-fg)] p-5 sm:grid-cols-2 sm:gap-10 sm:p-8"
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
              <h2
                id={headingId}
                className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl"
              >
                {section.heading}
              </h2>
              <Paragraphs text={section.body} className="text-[var(--sf-muted)]" />
              {section.cta ? (
                <ThemeLink
                  href={section.cta.link}
                  className="inline-flex min-h-11 items-center font-bold text-[var(--sf-link)] underline underline-offset-4"
                >
                  {section.cta.label}
                </ThemeLink>
              ) : null}
            </div>
          </section>
        );
      case "brand_logos":
        return (
          <section key={section.id} aria-labelledby={headingId} className="space-y-4">
            <SectionHeading id={headingId} title={section.title} />
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {section.brands.map((brand) => (
                <li key={brand.slug}>
                  <Link
                    href={`/marca/${encodeURIComponent(brand.slug)}`}
                    className="flex h-20 items-center justify-center rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-3 hover:border-[var(--sf-primary)]"
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
            <SectionHeading id={headingId} title={section.title} />
            <ul className="grid gap-3 sm:grid-cols-3 sm:gap-4">
              {section.items.map((item, i) => (
                <li key={i}>
                  <figure className="flex h-full flex-col gap-4 rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] p-5">
                    <blockquote className="text-base leading-relaxed">
                      <Paragraphs text={item.quote} />
                    </blockquote>
                    <figcaption className="mt-auto text-sm">
                      <span className="font-bold">{item.author}</span>
                      {item.detail ? <span className="block">{item.detail}</span> : null}
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
              <h2
                id={headingId}
                className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl"
              >
                {section.heading}
              </h2>
            ) : null}
            <SafeHtml html={section.html} className="sf-prose" />
          </section>
        );
      case "faq":
        return <FaqBlock section={section} headingId={headingId} />;
      case "benefits":
        return <BenefitsBlock section={section} headingId={headingId} />;
      case "goals":
        return <GoalsBlock section={section} headingId={headingId} />;
      case "reviews":
        return <ReviewsBlock section={section} headingId={headingId} />;
      case "video":
        return <VideoBlock section={section} headingId={headingId} />;
      case "contact_map":
        return <ContactBlock section={section} headingId={headingId} contact={contact} />;
      default:
        return null;
    }
  }
}
