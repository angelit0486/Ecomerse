import Link from "next/link";

import type { BenefitIcon } from "@/lib/theme/constants";
import type { HomeSectionData } from "@/server/storefront/catalog";

import { Stars } from "./stars";
import { VideoFacade } from "./video-facade";

/**
 * Bloques del tema v2 (ADR-034). Todo es texto escapado por React: ningún
 * bloque nuevo admite HTML. El video solo carga al tocarlo.
 */
type Block<T extends HomeSectionData["type"]> = Extract<HomeSectionData, { type: T }>;

const HEADING = "text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl";

/** Íconos de trazo, dibujados aquí (sin imágenes externas ni SVG de la tienda). */
const ICON_PATHS: Record<BenefitIcon, string> = {
  truck: "M3 7h11v8H3zM14 10h4l3 3v2h-7M7 18a2 2 0 1 0 0-.01M17 18a2 2 0 1 0 0-.01",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
  return: "M9 14l-4-4 4-4M5 10h10a4 4 0 0 1 0 8h-3",
  chat: "M4 5h16v11H8l-4 4zM8 10h8M8 13h5",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  leaf: "M5 19c0-8 6-14 15-14 0 9-6 15-14 15M5 19l7-7",
  lab: "M9 3h6M10 3v6L5 18a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  gift: "M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
};

function Icon({ name }: { name: BenefitIcon }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function FaqBlock({ section, headingId }: { section: Block<"faq">; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="max-w-3xl space-y-4">
      <h2 id={headingId} className={HEADING}>
        {section.title}
      </h2>
      <div className="divide-y divide-[var(--sf-border)] border-y border-[var(--sf-border)]">
        {section.items.map((item, i) => (
          <details key={i} className="group py-1">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-2 text-base font-semibold [&::-webkit-details-marker]:hidden">
              {item.question}
              <span
                aria-hidden="true"
                className="text-xl leading-none motion-safe:transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <div className="space-y-2 pb-4 text-[var(--sf-muted)]">
              {item.answer
                .split(/\n+/)
                .filter(Boolean)
                .map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export function BenefitsBlock({
  section,
  headingId,
}: {
  section: Block<"benefits">;
  headingId: string;
}) {
  return (
    <section
      aria-labelledby={section.title ? headingId : undefined}
      aria-label={section.title ? undefined : "Beneficios"}
      className="space-y-4"
    >
      {section.title ? (
        <h2 id={headingId} className={HEADING}>
          {section.title}
        </h2>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {section.items.map((item, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] p-4"
          >
            <span className="text-[var(--sf-link)]">
              <Icon name={item.icon} />
            </span>
            <span className="font-bold leading-tight">{item.title}</span>
            {item.text ? <span className="text-sm text-[var(--sf-muted)]">{item.text}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GoalsBlock({ section, headingId }: { section: Block<"goals">; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className={HEADING}>
        {section.title}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {section.goals.map((g) => (
          <li key={`${g.attribute}:${g.value}`}>
            <Link
              href={`/productos?${encodeURIComponent(g.attribute)}=${encodeURIComponent(g.value)}`}
              className="inline-flex min-h-11 items-center rounded-full border-2 border-[var(--sf-fg)] px-5 font-semibold hover:bg-[var(--sf-fg)] hover:text-[var(--sf-bg)]"
            >
              {g.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opiniones verificadas y aprobadas (ADR-029). Sin JSON-LD aquí: va en la ficha. */
export function ReviewsBlock({
  section,
  headingId,
}: {
  section: Block<"reviews">;
  headingId: string;
}) {
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className={HEADING}>
        {section.title}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {section.reviews.map((r, i) => (
          <li key={i}>
            <figure className="flex h-full flex-col gap-3 rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] p-5">
              <Stars value={r.rating} />
              {r.title ? <p className="font-bold">{r.title}</p> : null}
              <blockquote className="line-clamp-5 leading-relaxed">{r.body}</blockquote>
              <figcaption className="mt-auto text-sm">
                <span className="font-bold">{r.author_name}</span>
                <span className="block text-[var(--sf-muted)]">
                  Compra verificada ·{" "}
                  <Link
                    href={`/productos/${encodeURIComponent(r.product.slug)}`}
                    className="underline underline-offset-2"
                  >
                    {r.product.title}
                  </Link>
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function VideoBlock({ section, headingId }: { section: Block<"video">; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-4xl space-y-3">
      <h2 id={headingId} className={HEADING}>
        {section.title}
      </h2>
      <VideoFacade provider={section.provider} videoId={section.video_id} title={section.title} />
      {section.caption ? <p className="text-[var(--sf-muted)]">{section.caption}</p> : null}
    </section>
  );
}

/** Dirección, horario y WhatsApp del contacto de la tienda; sin mapa incrustado. */
export function ContactBlock({
  section,
  headingId,
  contact,
}: {
  section: Block<"contact_map">;
  headingId: string;
  contact: { address?: string; hours?: string; whatsapp?: string };
}) {
  if (!contact.address && !contact.hours && !(section.show_whatsapp && contact.whatsapp)) {
    return null;
  }
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-4 rounded-[var(--sf-radius-panel)] border-2 border-[var(--sf-fg)] p-5 sm:grid-cols-2 sm:p-8"
    >
      <h2 id={headingId} className={`${HEADING} sm:col-span-2`}>
        {section.title}
      </h2>
      {contact.address ? (
        <div className="space-y-2">
          <h3 className="font-bold">Dirección</h3>
          <address className="whitespace-pre-line not-italic text-[var(--sf-muted)]">
            {contact.address}
          </address>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`}
            rel="noopener noreferrer"
            target="_blank"
            className="inline-flex min-h-11 items-center font-bold text-[var(--sf-link)] underline underline-offset-4"
          >
            Ver en el mapa<span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </div>
      ) : null}
      <div className="space-y-2">
        {contact.hours ? (
          <>
            <h3 className="font-bold">Horario</h3>
            <p className="whitespace-pre-line text-[var(--sf-muted)]">{contact.hours}</p>
          </>
        ) : null}
        {section.show_whatsapp && contact.whatsapp ? (
          <a
            href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`}
            rel="noopener noreferrer"
            target="_blank"
            className="inline-flex min-h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-6 font-bold text-[var(--sf-btn-fg)]"
          >
            Escríbenos por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
