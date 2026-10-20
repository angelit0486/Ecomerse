"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { contrastRatio } from "@/lib/color/contrast";
import { SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/theme/links";
import {
  buttonTextColor,
  COLOR_KEYS,
  contrastIssues,
  resolvePalette,
  type Palette,
} from "@/lib/theme/palette";
import { THEME_PRESETS, type ThemePreset } from "@/lib/theme/presets";
import {
  FONT_KEYS,
  PAYMENT_METHODS,
  type FontKey,
  type PaymentMethod,
  type ThemeSettings,
} from "@/lib/theme/schema";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { Select } from "@/ui/primitives/select";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { submitKeepingState } from "../_shared/submit";
import { nativeControl } from "../productos/styles";
import { discardThemeDraft, publishTheme, saveThemeSection } from "./actions";
import type { ThemeSection } from "./patch";

/** Formularios de Apariencia (F9-T01, F9-DESIGN §7). Controlados: un error no borra nada. */

const COLOR_LABELS: Record<(typeof COLOR_KEYS)[number], string> = {
  primary: "Color principal (botones y enlaces)",
  accent: "Color de acento",
  background: "Fondo",
  foreground: "Texto",
  muted: "Texto secundario",
};

export const FONT_LABELS: Record<FontKey, string> = {
  inter: "Inter (neutra)",
  "dm-sans": "DM Sans (moderna)",
  manrope: "Manrope (redondeada)",
  "work-sans": "Work Sans (legible)",
  lora: "Lora (con serifa)",
  oswald: "Oswald (condensada, deportiva)",
  "barlow-condensed": "Barlow Condensed (condensada)",
  montserrat: "Montserrat (geométrica)",
  "playfair-display": "Playfair Display (editorial)",
  "space-grotesk": "Space Grotesk (técnica)",
};

const NETWORK_LABELS: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X (Twitter)",
  whatsapp: "WhatsApp (enlace)",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  oxxo: "OXXO",
  spei: "SPEI (transferencia)",
  paypal: "PayPal",
  mercado_pago: "Mercado Pago",
  cash_on_delivery: "Pago contra entrega",
};

function useSection(storeHandle: string, section: ThemeSection) {
  return useActionState<FormState, FormData>(saveThemeSection.bind(null, storeHandle, section), {});
}

function SaveRow({ state, pending }: { state: FormState; pending: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" loading={pending}>
        Guardar en el borrador
      </Button>
      <FormFeedback state={state} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Marca: colores, tipografía y forma
// -----------------------------------------------------------------------------
/** Qué falla con cada color, en palabras de la dueña (antes vivía en el asistente). */
const CONTRAST_ISSUE: Record<(typeof COLOR_KEYS)[number], string> = {
  foreground: "El texto no se lee bien sobre el fondo",
  muted: "El texto secundario no se lee bien sobre el fondo",
  primary: "Los botones no se distinguen del fondo",
  accent: "El acento no se distingue del fondo",
  background: "",
};

/**
 * Marca: estilos sugeridos, colores, tipografía y forma, con vista previa en
 * vivo. Es el único formulario de marca: lo usan Apariencia y el asistente
 * «Configurar tienda» (misión panel, F2; antes había dos distintos).
 */
export function BrandForm({
  storeHandle,
  revision,
  settings,
  storeName,
}: {
  storeHandle: string;
  revision: number;
  settings: ThemeSettings;
  storeName: string;
}) {
  const [state, action, pending] = useSection(storeHandle, "marca");
  const [palette, setPalette] = useState<Palette>(resolvePalette(settings.colors));
  const [heading, setHeading] = useState<FontKey>(settings.typography?.heading ?? "inter");
  const [body, setBody] = useState<FontKey>(settings.typography?.body ?? "inter");
  const [radius, setRadius] = useState(settings.shape?.radius ?? "md");
  const [style, setStyle] = useState<"solid" | "outline">(settings.shape?.button_style ?? "solid");
  const issues = useMemo(() => contrastIssues(palette, style), [palette, style]);
  const failing = new Set(issues.map((i) => i.key));
  const fontOptions = FONT_KEYS.map((k) => ({ value: k, label: FONT_LABELS[k] }));
  const [applied, setApplied] = useState<string | null>(null);

  function applyPreset(preset: ThemePreset) {
    setPalette(preset.colors);
    setHeading(preset.heading);
    setBody(preset.body);
    setRadius(preset.radius);
    setStyle(preset.buttonStyle);
    setApplied(preset.name);
  }

  return (
    <form action={action} onSubmit={submitKeepingState(action)} className="space-y-6" noValidate>
      <input type="hidden" name="revision" value={revision} />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Estilos sugeridos</legend>
        <p className="text-sm text-fg-muted">
          Llenan los campos de abajo; revisa, ajusta y guarda en el borrador.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {THEME_PRESETS.map((preset) => (
            <li
              key={preset.key}
              className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3"
            >
              <span className="text-sm font-medium">{preset.name}</span>
              <span className="text-[13px] text-fg-muted">{preset.description}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyPreset(preset)}
              >
                Usar el estilo {preset.name}
              </Button>
            </li>
          ))}
        </ul>
        <p aria-live="polite" className="text-sm">
          {applied
            ? `Estilo ${applied} listo en el formulario. Guárdalo para verlo en la vista previa.`
            : ""}
        </p>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Colores</legend>
        {COLOR_KEYS.map((key) => (
          <Field
            key={key}
            label={COLOR_LABELS[key]}
            error={state.fields?.[key] ?? (failing.has(key) ? CONTRAST_ISSUE[key] : undefined)}
          >
            {(c) => (
              <Input
                {...c}
                name={key}
                type="color"
                value={palette[key]}
                onChange={(e) => setPalette((p) => ({ ...p, [key]: e.target.value.toLowerCase() }))}
                className="h-10 w-24 p-1"
              />
            )}
          </Field>
        ))}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Tipografía</legend>
        <Field label="Títulos" error={state.fields?.heading_font}>
          {(c) => (
            <Select
              {...c}
              name="heading_font"
              value={heading}
              onValueChange={(v) => setHeading(v as FontKey)}
              options={fontOptions}
            />
          )}
        </Field>
        <Field label="Textos" error={state.fields?.body_font}>
          {(c) => (
            <Select
              {...c}
              name="body_font"
              value={body}
              onValueChange={(v) => setBody(v as FontKey)}
              options={fontOptions}
            />
          )}
        </Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Botones</legend>
        <Field label="Esquinas">
          {(c) => (
            <Select
              {...c}
              name="radius"
              value={radius}
              onValueChange={(v) => setRadius(v as typeof radius)}
              options={[
                { value: "none", label: "Rectas" },
                { value: "sm", label: "Poco redondeadas" },
                { value: "md", label: "Redondeadas" },
                { value: "full", label: "Píldora" },
              ]}
            />
          )}
        </Field>
        <Field label="Estilo" hint="El contorno exige más contraste del color principal.">
          {(c) => (
            <Select
              {...c}
              name="button_style"
              value={style}
              onValueChange={(v) => setStyle(v === "outline" ? "outline" : "solid")}
              options={[
                { value: "solid", label: "Relleno" },
                { value: "outline", label: "Contorno" },
              ]}
            />
          )}
        </Field>
      </fieldset>
      <BrandPreview palette={palette} storeName={storeName} />
      {issues.length > 0 ? (
        <p role="alert" className="text-sm text-danger">
          Ajusta los colores marcados: el contraste no es suficiente para leerse bien (WCAG AA).
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} disabled={issues.length > 0}>
          Guardar en el borrador
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

/**
 * Vista previa en vivo con los colores elegidos. Los estilos se aplican por CSSOM
 * tras el montaje (la CSP con nonce bloquea atributos style en el HTML).
 */
function BrandPreview({ palette, storeName }: { palette: Palette; storeName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--p-bg", palette.background);
    el.style.setProperty("--p-fg", palette.foreground);
    el.style.setProperty("--p-muted", palette.muted);
    el.style.setProperty("--p-primary", palette.primary);
    el.style.setProperty("--p-primary-fg", buttonTextColor(palette.primary));
    el.style.setProperty("--p-accent", palette.accent);
  }, [palette]);
  return (
    <div
      ref={ref}
      aria-label="Vista previa de la marca"
      role="img"
      className="rounded-md border border-border bg-[var(--p-bg)] p-5"
    >
      <p className="text-lg font-semibold text-[var(--p-fg)]">{storeName}</p>
      <p className="mt-1 text-sm text-[var(--p-muted)]">
        Así verán tus clientes los textos secundarios.
      </p>
      <p className="mt-2 text-sm text-[var(--p-accent)] underline">Un enlace de ejemplo</p>
      <span className="mt-4 inline-block rounded-md bg-[var(--p-primary)] px-4 py-2 text-sm text-[var(--p-primary-fg)]">
        Agregar al carrito
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Encabezado y pie
// -----------------------------------------------------------------------------
export function HeaderFooterForm({
  storeHandle,
  revision,
  settings,
  menusHref,
}: {
  storeHandle: string;
  revision: number;
  settings: ThemeSettings;
  menusHref: string | null;
}) {
  const [state, action, pending] = useSection(storeHandle, "encabezado");
  const bar = settings.header?.announcement;
  const [logoPosition, setLogoPosition] = useState(settings.header?.logo_position ?? "left");
  const [text, setText] = useState(bar?.text ?? "");
  const [link, setLink] = useState(bar?.link ?? "");
  const [bg, setBg] = useState(bar?.background ?? "#111827");
  const [fg, setFg] = useState(bar?.foreground ?? "#ffffff");
  const [legal, setLegal] = useState(settings.footer?.legal_text ?? "");
  const [payments, setPayments] = useState<Set<string>>(
    new Set(settings.footer?.payment_methods ?? []),
  );
  const barRatio = contrastRatio(fg, bg);
  const barLow = text.trim() !== "" && barRatio < 4.5;

  return (
    <form action={action} onSubmit={submitKeepingState(action)} className="space-y-6" noValidate>
      <input type="hidden" name="revision" value={revision} />
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold">Encabezado</legend>
        <Field label="Posición del logo">
          {(c) => (
            <Select
              {...c}
              name="logo_position"
              value={logoPosition}
              onValueChange={(v) => setLogoPosition(v === "center" ? "center" : "left")}
              options={[
                { value: "left", label: "A la izquierda" },
                { value: "center", label: "Centrado" },
              ]}
            />
          )}
        </Field>
        <Field
          label="Barra de anuncio"
          hint="Hasta 120 caracteres. Vacía, no se muestra."
          error={state.fields?.announcement_text}
        >
          {(c) => (
            <Input
              {...c}
              name="announcement_text"
              value={text}
              maxLength={120}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Enlace de la barra (opcional)"
          hint="Una ruta de tu tienda como /productos o una dirección https://."
          error={state.fields?.announcement_link}
        >
          {(c) => (
            <Input
              {...c}
              name="announcement_link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-6">
          <Field label="Fondo de la barra" error={state.fields?.announcement_background}>
            {(c) => (
              <Input
                {...c}
                name="announcement_background"
                type="color"
                value={bg}
                onChange={(e) => setBg(e.target.value.toLowerCase())}
                className="h-10 w-24 p-1"
              />
            )}
          </Field>
          <Field
            label="Texto de la barra"
            error={
              state.fields?.announcement_foreground ??
              (barLow ? `Contraste ${barRatio.toFixed(1)}:1; necesita al menos 4.5:1.` : undefined)
            }
          >
            {(c) => (
              <Input
                {...c}
                name="announcement_foreground"
                type="color"
                value={fg}
                onChange={(e) => setFg(e.target.value.toLowerCase())}
                className="h-10 w-24 p-1"
              />
            )}
          </Field>
        </div>
        {menusHref ? (
          <p className="text-sm">
            El menú principal y el del pie se editan en{" "}
            <a href={menusHref} className="underline">
              Contenido → Menús
            </a>
            .
          </p>
        ) : null}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold">Pie de página</legend>
        <Field
          label="Texto legal (opcional)"
          hint="Por ejemplo, razón social y aviso de responsabilidad. Hasta 500 caracteres."
          error={state.fields?.legal_text}
        >
          {(c) => (
            <textarea
              {...c}
              name="legal_text"
              rows={3}
              maxLength={500}
              value={legal}
              onChange={(e) => setLegal(e.target.value)}
              className={`${nativeControl} h-auto py-2`}
            />
          )}
        </Field>
        <fieldset>
          <legend className="text-[13px] font-medium">Formas de pago que se muestran</legend>
          <p className="text-[13px] text-fg-muted">
            Solo informan al comprador; los cobros se configuran en Ajustes → Pagos.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="payment_methods"
                  value={m}
                  checked={payments.has(m)}
                  onChange={(e) =>
                    setPayments((all) => {
                      const next = new Set(all);
                      if (e.target.checked) next.add(m);
                      else next.delete(m);
                      return next;
                    })
                  }
                />
                {PAYMENT_LABELS[m]}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      <SaveRow state={state} pending={pending} />
    </form>
  );
}

// -----------------------------------------------------------------------------
// Redes y contacto
// -----------------------------------------------------------------------------
export function SocialContactForm({
  storeHandle,
  revision,
  settings,
  profileHref,
  email,
  phone,
}: {
  storeHandle: string;
  revision: number;
  settings: ThemeSettings;
  profileHref: string | null;
  email: string | null;
  phone: string | null;
}) {
  const [state, action, pending] = useSection(storeHandle, "redes");
  const initial = Object.fromEntries((settings.social ?? []).map((s) => [s.network, s.url]));
  const [urls, setUrls] = useState<Record<string, string>>(initial);
  const [whatsapp, setWhatsapp] = useState(settings.contact?.whatsapp ?? "");
  const [address, setAddress] = useState(settings.contact?.address ?? "");
  const [hours, setHours] = useState(settings.contact?.hours ?? "");

  return (
    <form action={action} onSubmit={submitKeepingState(action)} className="space-y-6" noValidate>
      <input type="hidden" name="revision" value={revision} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Redes sociales</legend>
        {SOCIAL_NETWORKS.map((network) => (
          <Field
            key={network}
            label={NETWORK_LABELS[network]}
            error={state.fields?.[`social_${network}`]}
          >
            {(c) => (
              <Input
                {...c}
                name={`social_${network}`}
                inputMode="url"
                placeholder={network === "whatsapp" ? "wa.me/52…" : `${network}.com/…`}
                value={urls[network] ?? ""}
                onChange={(e) => setUrls((u) => ({ ...u, [network]: e.target.value }))}
              />
            )}
          </Field>
        ))}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold">Contacto</legend>
        <p className="text-sm text-fg-muted">
          Email: {email ?? "sin configurar"} · Teléfono: {phone ?? "sin configurar"}.
          {profileHref ? (
            <>
              {" "}
              Se cambian en{" "}
              <a href={profileHref} className="underline">
                los datos de la tienda
              </a>
              .
            </>
          ) : null}
        </p>
        <Field
          label="WhatsApp"
          hint="Con lada; un número de 10 dígitos se toma como de México."
          error={state.fields?.whatsapp}
        >
          {(c) => (
            <Input
              {...c}
              name="whatsapp"
              inputMode="tel"
              autoComplete="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          )}
        </Field>
        <Field label="Dirección (opcional)" error={state.fields?.address}>
          {(c) => (
            <textarea
              {...c}
              name="address"
              rows={2}
              maxLength={300}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={`${nativeControl} h-auto py-2`}
            />
          )}
        </Field>
        <Field
          label="Horario (opcional)"
          hint="Por ejemplo: Lunes a viernes de 9 a 18 h."
          error={state.fields?.hours}
        >
          {(c) => (
            <textarea
              {...c}
              name="hours"
              rows={2}
              maxLength={200}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={`${nativeControl} h-auto py-2`}
            />
          )}
        </Field>
      </fieldset>
      <SaveRow state={state} pending={pending} />
    </form>
  );
}

// -----------------------------------------------------------------------------
// SEO global
// -----------------------------------------------------------------------------
export interface ImageOption {
  id: string;
  url: string;
  alt: string | null;
}

export function SeoForm({
  storeHandle,
  revision,
  settings,
  storeName,
  images,
}: {
  storeHandle: string;
  revision: number;
  settings: ThemeSettings;
  storeName: string;
  images: ImageOption[];
}) {
  const [state, action, pending] = useSection(storeHandle, "seo");
  const [title, setTitle] = useState(settings.seo?.title ?? "");
  const [description, setDescription] = useState(settings.seo?.description ?? "");
  const [image, setImage] = useState(settings.seo?.image_media_id ?? "");

  return (
    <form action={action} onSubmit={submitKeepingState(action)} className="space-y-6" noValidate>
      <input type="hidden" name="revision" value={revision} />
      <Field
        label="Título de la portada"
        hint={`Hasta 70 caracteres. Vacío: «${storeName}».`}
        error={state.fields?.seo_title}
      >
        {(c) => (
          <Input
            {...c}
            name="seo_title"
            maxLength={70}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Descripción"
        hint={`Hasta 160 caracteres (${[...description].length}/160). Se usa en buscadores y al compartir.`}
        error={state.fields?.seo_description}
      >
        {(c) => (
          <textarea
            {...c}
            name="seo_description"
            rows={3}
            maxLength={160}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${nativeControl} h-auto py-2`}
          />
        )}
      </Field>
      <fieldset>
        <legend className="text-[13px] font-medium">Imagen al compartir</legend>
        <p className="text-[13px] text-fg-muted">
          Se elige entre los banners y las imágenes de marca ya procesados (ideal 1200 × 630).
        </p>
        {state.fields?.seo_image_media_id ? (
          <p className="text-[13px] text-danger">{state.fields.seo_image_media_id}</p>
        ) : null}
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col items-center justify-center gap-2 rounded-md border border-border p-3 text-sm">
            <input
              type="radio"
              name="seo_image_media_id"
              value=""
              checked={image === ""}
              onChange={() => setImage("")}
            />
            Sin imagen
          </label>
          {images.map((img) => (
            <label
              key={img.id}
              className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- imagen ya re-codificada */}
              <img
                src={img.url}
                alt={img.alt ?? ""}
                className="aspect-[1200/630] w-full object-cover"
              />
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="seo_image_media_id"
                  value={img.id}
                  checked={image === img.id}
                  onChange={() => setImage(img.id)}
                />
                {img.alt ?? "Imagen sin descripción"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <SaveRow state={state} pending={pending} />
    </form>
  );
}

// -----------------------------------------------------------------------------
// Barra de publicación
// -----------------------------------------------------------------------------
export function PublishBar({
  storeHandle,
  section,
  revision,
  hasDraft,
  publishedAt,
  previewAction,
}: {
  storeHandle: string;
  section: string;
  revision: number;
  hasDraft: boolean;
  publishedAt: string | null;
  previewAction: string;
}) {
  const [publishState, publish, publishing] = useActionState<FormState, FormData>(
    publishTheme.bind(null, storeHandle),
    {},
  );
  const [discardState, discard, discarding] = useActionState<FormState, FormData>(
    discardThemeDraft.bind(null, storeHandle, section),
    {},
  );
  const [confirm, setConfirm] = useState(false);

  return (
    <section
      aria-labelledby="estado-borrador"
      className="space-y-3 rounded-md border border-border bg-surface p-4"
    >
      <h2 id="estado-borrador" className="text-sm font-semibold">
        {hasDraft ? "Hay cambios sin publicar" : "Todo está publicado"}
      </h2>
      <p className="text-sm text-fg-muted">
        {hasDraft
          ? "Tus clientes siguen viendo la versión publicada hasta que publiques."
          : publishedAt
            ? `Última publicación: ${new Date(publishedAt).toLocaleString("es-MX")}.`
            : "Todavía no has publicado una apariencia propia."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={previewAction}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-control bg-surface px-4 text-sm font-medium text-fg hover:bg-canvas"
        >
          Vista previa<span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
        {hasDraft ? (
          <form action={publish} onSubmit={submitKeepingState(publish)}>
            <input type="hidden" name="revision" value={revision} />
            <Button type="submit" loading={publishing}>
              Publicar
            </Button>
          </form>
        ) : null}
      </div>
      <FormFeedback state={publishState} />
      {hasDraft ? (
        <form
          action={discard}
          onSubmit={submitKeepingState(discard)}
          className="flex flex-wrap items-center gap-3 border-t border-border pt-3"
        >
          <input type="hidden" name="revision" value={revision} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="confirm"
              value="1"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            Quiero descartar todos los cambios sin publicar
          </label>
          <Button type="submit" variant="ghost" loading={discarding}>
            Descartar borrador
          </Button>
          <FormFeedback state={discardState} />
        </form>
      ) : null}
    </section>
  );
}
