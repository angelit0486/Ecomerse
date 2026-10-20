"use client";

import { useState } from "react";

import type { HomeSectionType } from "@/lib/theme/schema";

import type { EditorSection } from "./home-editor";

/**
 * Esquema en vivo de la portada (ADR-034 §3): qué bloques se ven en el celular
 * y en la computadora, en su orden, mientras se edita. No pretende ser la
 * tienda (no lee productos ni imágenes); para eso está la vista previa privada.
 */
type Device = "mobile" | "desktop";

function headline(section: EditorSection): string {
  const p = section.props;
  for (const key of ["heading", "title"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (section.type === "rich_text") return "Texto";
  return "";
}

function detail(section: EditorSection): string | null {
  const p = section.props;
  const count = (key: string) => (Array.isArray(p[key]) ? (p[key] as unknown[]).length : 0);
  switch (section.type) {
    case "faq":
      return `${count("items")} preguntas`;
    case "benefits":
      return `${count("items")} beneficios`;
    case "goals":
      return `${count("value_ids")} objetivos`;
    case "testimonials":
      return `${count("items")} testimonios`;
    case "featured_products": {
      const layout = p.layout === "carousel" ? "carrusel" : "cuadrícula";
      return `Hasta ${Number(p.limit ?? 8)} productos · ${layout}`;
    }
    case "reviews":
      return `Hasta ${Number(p.limit ?? 6)} opiniones aprobadas`;
    default:
      return null;
  }
}

function scheduled(section: EditorSection, now: number): string | null {
  if (section.starts_at && Date.parse(section.starts_at) > now) return "programado";
  if (section.ends_at && Date.parse(section.ends_at) <= now) return "ya terminó";
  return null;
}

export function HomePreview({
  sections,
  labels,
}: {
  sections: EditorSection[];
  labels: Record<HomeSectionType, string>;
}) {
  const [device, setDevice] = useState<Device>("mobile");
  const [now] = useState(() => Date.now());
  const visible = sections.filter(
    (s) => s.enabled && (s.visibility ?? "all") !== (device === "mobile" ? "desktop" : "mobile"),
  );
  return (
    <section aria-labelledby="esquema-portada" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="esquema-portada" className="mr-auto text-sm font-semibold">
          Así queda el orden
        </h3>
        <div role="group" aria-label="Dispositivo" className="flex gap-1">
          {(["mobile", "desktop"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={`min-h-11 rounded-md border px-3 text-sm md:min-h-9 ${
                device === d ? "border-fg font-medium" : "border-border"
              }`}
            >
              {d === "mobile" ? "Celular" : "Computadora"}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`mx-auto rounded-xl border border-border bg-canvas p-3 ${
          device === "mobile" ? "max-w-[375px]" : "w-full"
        }`}
      >
        {visible.length === 0 ? (
          <p className="p-4 text-center text-sm text-fg-muted">
            {sections.length === 0
              ? "Sin bloques: la tienda muestra la plantilla del tema."
              : "Ningún bloque se ve en este dispositivo."}
          </p>
        ) : (
          <ol
            className={`grid gap-2 ${device === "desktop" ? "sm:grid-cols-1" : ""}`}
            aria-label={`Bloques visibles en ${device === "mobile" ? "el celular" : "la computadora"}`}
          >
            {visible.map((s) => {
              const extra = detail(s);
              const when = scheduled(s, now);
              return (
                <li
                  key={s.id}
                  className={`rounded-md border border-dashed border-border bg-surface p-3 ${
                    s.type === "hero" ? "py-8 text-center" : ""
                  }`}
                >
                  <p className="text-[12px] text-fg-muted">
                    {labels[s.type]}
                    {when ? ` · ${when}` : ""}
                  </p>
                  <p className="text-sm font-medium">{headline(s) || "Sin título todavía"}</p>
                  {extra ? <p className="text-[12px] text-fg-muted">{extra}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <p className="text-[13px] text-fg-muted">
        Es un esquema. Para ver tu tienda con productos e imágenes reales, guarda y abre «Ver vista
        previa».
      </p>
    </section>
  );
}
