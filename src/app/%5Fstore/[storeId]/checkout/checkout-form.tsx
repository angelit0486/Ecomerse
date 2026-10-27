"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type FormEvent,
} from "react";

const noSubscribe = () => () => {};

import { MX_STATES, stateForPostalCode } from "@/lib/checkout/mx-states";
import type { CartView, PaymentMethod } from "@/server/storefront/cart";
import { submitKeepingState } from "@/ui/submit";

import { checkout, type CartActionState } from "../carrito/actions";

const input =
  "h-11 w-full rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3 text-sm";

/** Campos que definen la cotización del envío. */
const ADDRESS_FIELDS = ["line1", "line2", "city", "region", "postal_code", "country"] as const;
const REQUIRED_ADDRESS = ["line1", "city", "region", "postal_code"] as const;

function addressKey(form: HTMLFormElement): string | null {
  const data = new FormData(form);
  const value = (name: string) => String(data.get(name) ?? "").trim();
  if (REQUIRED_ADDRESS.some((name) => !value(name))) return null;
  return ADDRESS_FIELDS.map(value).join("\u0000");
}

const COUNTRY_NAMES: Record<string, string> = {
  MX: "México",
  US: "Estados Unidos",
  CO: "Colombia",
  AR: "Argentina",
  CL: "Chile",
  PE: "Perú",
  ES: "España",
};

/** Espera tras el último cambio antes de cotizar (el autocompletado llena varios campos seguidos). */
const QUOTE_DELAY_MS = 600;

function Field({
  label,
  name,
  error,
  ...rest
}: {
  label: string;
  name: string;
  error?: string | undefined;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `co-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        className={input}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-[var(--sf-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CheckoutForm({
  storeId,
  storeCountry,
  cart,
  methods,
  idempotencyKey,
  shippingLabels,
  totalLabel,
}: {
  storeId: string;
  storeCountry: string;
  cart: CartView;
  methods: PaymentMethod[];
  idempotencyKey: string;
  /** Precio ya formateado de cada tarifa (rate_id → texto). */
  shippingLabels: Record<string, string>;
  /** Total ya formateado, repetido en el botón de confirmar. */
  totalLabel: string;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    checkout.bind(null, storeId),
    {},
  );
  const a = cart.shipping_address;
  // Un error se quita en cuanto la persona corrige ese campo (no hasta el siguiente envío).
  const [edited, setEdited] = useState<{ for: CartActionState; names: Set<string> }>({
    for: state,
    names: new Set(),
  });
  const editedNames = edited.for === state ? edited.names : new Set<string>();
  const f = Object.fromEntries(
    Object.entries(state.fields ?? {}).filter(([name]) => !editedNames.has(name)),
  ) as NonNullable<CartActionState["fields"]>;
  // «Faltan N datos» baja conforme se corrigen los campos y desaparece en cero.
  const missingTotal = Object.keys(state.fields ?? {}).length;
  const missingLeft = Object.keys(f).length;
  const errorMessage =
    state.error && missingTotal > 0 && missingLeft < missingTotal
      ? missingLeft > 0
        ? `Faltan ${missingLeft} ${missingLeft === 1 ? "dato" : "datos"}. Revisa los campos marcados.`
        : null
      : state.error;
  function markEditedName(name: string) {
    if (!name || !state.fields?.[name] || editedNames.has(name)) return;
    setEdited({ for: state, names: new Set([...editedNames, name]) });
  }
  function markEdited(event: FormEvent<HTMLFormElement>) {
    markEditedName((event.target as HTMLInputElement).name);
  }
  const selectedRate =
    cart.shipping.status === "ok" ? cart.shipping.rate_id : cart.shipping_rate_id;
  // Solo el país de la tienda (las zonas de envío de hoy son nacionales); se
  // conserva el de una dirección ya guardada si fuera otro.
  const countryCodes = [...new Set([storeCountry, ...(a?.country ? [a.country] : [])])];
  const [country, setCountry] = useState(a?.country ?? storeCountry);
  const submit = submitKeepingState(action);
  const formRef = useRef<HTMLFormElement>(null);
  // Con JS se cotiza solo: el botón «Calcular envío» queda para quien no tiene JS.
  // (en el servidor vale false, en el cliente true; sin estado en un efecto).
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  // Un clic en un botón de envío no dispara la cotización al salir del campo
  // (en Safari el clic no enfoca el botón y el «blur» llegaba antes; Gate F9).
  const submitting = useRef(false);
  // Tras un error por campo, el foco va al primero (en el orden del formulario).
  useEffect(() => {
    const names = Object.keys(state.fields ?? {});
    if (names.length === 0) return;
    const first = formRef.current?.querySelector<HTMLElement>(
      names.map((n) => `[name="${n}"]`).join(","),
    );
    first?.focus();
  }, [state]);
  const quoteButton = useRef<HTMLButtonElement>(null);
  const quotedKey = useRef<string | null>(
    a
      ? [a.line1, a.line2 ?? "", a.city, a.region, a.postal_code, a.country]
          .map((v) => v.trim())
          .join("\u0000")
      : null,
  );

  /**
   * Cotiza el envío sola al terminar la dirección (F9-T03, compra en ≤ 3 clics):
   * al salir de un campo con la dirección completa y distinta de la cotizada. Si
   * el foco va a un botón de envío, ese botón ya envía el formulario. Sin JS
   * queda el botón «Calcular envío».
   */
  function quote(form: HTMLFormElement | null) {
    if (submitting.current) return;
    if (!form || pending) return;
    const key = addressKey(form);
    if (!key || key === quotedKey.current) return;
    quotedKey.current = key;
    form.requestSubmit(quoteButton.current);
  }
  function quoteOnBlur(event: FocusEvent<HTMLFieldSetElement>) {
    const next = event.relatedTarget;
    if (next instanceof HTMLButtonElement && next.type === "submit") return;
    quote(event.currentTarget.form);
  }
  // El autocompletado del navegador llena la dirección sin salir de los campos:
  // también se cotiza poco después del último cambio, antes de que se pulse
  // «Confirmar pedido» (antes ese primer clic solo calculaba el envío).
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    },
    [],
  );
  // Con el CP completo se propone el estado si aún no se eligió (solo México;
  // el cliente no decide el envío: la zona la resuelve la base al cotizar).
  function fillStateFromPostalCode(target: EventTarget) {
    if (!(target instanceof HTMLInputElement) || target.name !== "postal_code") return;
    const region = target.form?.elements.namedItem("region");
    if (!(region instanceof HTMLSelectElement) || region.value) return;
    const state = stateForPostalCode(target.value);
    if (!state) return;
    region.value = state;
    if (f.region) markEditedName("region");
  }
  function quoteOnChange(event: FormEvent<HTMLFieldSetElement>) {
    fillStateFromPostalCode(event.target);
    const form = event.currentTarget.form;
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(() => quote(form), QUOTE_DELAY_MS);
  }

  return (
    <form
      ref={formRef}
      action={action}
      onPointerDownCapture={(event) => {
        if ((event.target as HTMLElement).closest('button[type="submit"]'))
          submitting.current = true;
      }}
      onInput={markEdited}
      onChange={markEdited}
      onSubmit={(event) => {
        submitting.current = false;
        // Un envío (cotizar o confirmar) ya cotiza: no hace falta la cotización pendiente.
        if (quoteTimer.current) clearTimeout(quoteTimer.current);
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter === quoteButton.current) quotedKey.current = addressKey(event.currentTarget);
        submit(event);
      }}
      className="space-y-8"
      noValidate
    >
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="expected_total" value={cart.total} />
      <input type="hidden" name="requires_shipping" value={cart.requires_shipping ? "1" : "0"} />

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">Contacto</legend>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={cart.email ?? ""}
          error={f.email}
        />
        <Field
          label="Nombre completo"
          name="customer_name"
          autoComplete="name"
          required
          defaultValue={a?.recipient_name ?? ""}
          error={f.customer_name}
        />
        <Field
          label={cart.requires_shipping ? "Teléfono (para la paquetería)" : "Teléfono (opcional)"}
          inputMode="tel"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={a?.phone ?? ""}
          error={f.phone}
        />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" name="accepts_marketing" value="1" />
          Quiero recibir novedades y promociones por email
        </label>
      </fieldset>

      {cart.requires_shipping ? (
        <fieldset className="space-y-4" onBlur={quoteOnBlur} onInput={quoteOnChange}>
          <legend className="text-lg font-semibold">Dirección de envío</legend>
          {f.shipping_address ? (
            <p role="alert" className="text-sm text-[var(--sf-danger)]">
              {f.shipping_address}
            </p>
          ) : null}
          <Field
            label="Calle, número e interior"
            name="line1"
            autoComplete="address-line1"
            required
            defaultValue={a?.line1 ?? ""}
            error={f.line1}
          />
          <Field
            label="Colonia"
            name="line2"
            autoComplete="address-line2"
            defaultValue={a?.line2 ?? ""}
            error={f.line2}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Ciudad o municipio"
              name="city"
              autoComplete="address-level2"
              required
              defaultValue={a?.city ?? ""}
              error={f.city}
            />
            {country === "MX" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="co-region" className="text-sm font-medium">
                  Estado
                </label>
                <select
                  id="co-region"
                  name="region"
                  autoComplete="address-level1"
                  required
                  defaultValue={a?.region ?? ""}
                  className={input}
                  aria-invalid={f.region ? true : undefined}
                  aria-describedby={f.region ? "co-region-error" : undefined}
                >
                  <option value="" disabled>
                    Elige tu estado
                  </option>
                  {/* Una dirección guardada con otro texto se conserva tal cual. */}
                  {a?.region && !(MX_STATES as readonly string[]).includes(a.region) ? (
                    <option value={a.region}>{a.region}</option>
                  ) : null}
                  {MX_STATES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {f.region ? (
                  <p id="co-region-error" className="text-sm text-[var(--sf-danger)]">
                    {f.region}
                  </p>
                ) : null}
              </div>
            ) : (
              <Field
                label="Estado"
                name="region"
                autoComplete="address-level1"
                required
                defaultValue={a?.region ?? ""}
                error={f.region}
              />
            )}
            <Field
              label="Código postal"
              name="postal_code"
              autoComplete="postal-code"
              inputMode="numeric"
              maxLength={10}
              required
              defaultValue={a?.postal_code ?? ""}
              error={f.postal_code}
            />
            {countryCodes.length === 1 ? (
              // Un solo país: se muestra como dato, no como lista de una opción.
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">País</span>
                <p className="flex h-11 items-center text-sm">
                  {COUNTRY_NAMES[country] ?? country}
                </p>
                <input type="hidden" name="country" value={country} />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label htmlFor="co-country" className="text-sm font-medium">
                  País
                </label>
                <select
                  id="co-country"
                  name="country"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className={input}
                >
                  {countryCodes.map((code) => (
                    <option key={code} value={code}>
                      {COUNTRY_NAMES[code] ?? code}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button
            ref={quoteButton}
            type="submit"
            name="intent"
            value="quote"
            disabled={pending}
            className={`h-11 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-5 text-sm font-medium ${hydrated ? "hidden" : ""}`}
          >
            Calcular envío
          </button>

          <div role="group" aria-labelledby="co-shipping" className="space-y-2">
            <p id="co-shipping" className="font-medium">
              Forma de envío
            </p>
            {cart.shipping_options.length === 0 ? (
              <p className="text-sm text-[var(--sf-muted)]">
                {cart.shipping.status === "address_required"
                  ? "Escribe tu dirección completa para ver las formas de envío."
                  : "No hay envíos disponibles para esta dirección."}
              </p>
            ) : (
              cart.shipping_options.map((o) => (
                <label
                  key={o.rate_id}
                  className="flex items-center gap-3 rounded-[var(--sf-radius-control)] border border-[var(--sf-border)] p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="shipping_rate_id"
                    value={o.rate_id}
                    defaultChecked={o.rate_id === selectedRate}
                  />
                  <span className="flex-1">
                    {o.name}
                    {o.est_days_min != null && o.est_days_max != null ? (
                      <span className="text-[var(--sf-muted)]">
                        {" "}
                        · {o.est_days_min}–{o.est_days_max} días
                      </span>
                    ) : null}
                  </span>
                  <span>{shippingLabels[o.rate_id]}</span>
                </label>
              ))
            )}
            {f.shipping_rate_id ? (
              <p role="alert" className="text-sm text-[var(--sf-danger)]">
                {f.shipping_rate_id}
              </p>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-lg font-semibold">Forma de pago</legend>
        {methods.length === 0 ? (
          <p className="text-sm">Esta tienda todavía no recibe pagos en línea.</p>
        ) : (
          methods.map((m, i) => (
            <label
              key={m.id}
              className="flex items-center gap-3 rounded-[var(--sf-radius-control)] border border-[var(--sf-border)] p-3 text-sm"
            >
              <input type="radio" name="payment_account_id" value={m.id} defaultChecked={i === 0} />
              {m.display_name}
            </label>
          ))
        )}
        {f.payment_account_id ? (
          <p role="alert" className="text-sm text-[var(--sf-danger)]">
            {f.payment_account_id}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="co-note" className="text-sm font-medium">
          Nota para la tienda (opcional)
        </label>
        <textarea
          id="co-note"
          name="customer_note"
          maxLength={1000}
          rows={3}
          className="rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] p-3 text-sm"
        />
      </div>

      <div aria-live="polite">
        {errorMessage ? (
          <p role="alert" className="text-sm text-[var(--sf-danger)]">
            {errorMessage}
          </p>
        ) : state.ok ? (
          <p role="status" className="text-sm">
            {state.message}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        name="intent"
        value="place"
        disabled={pending || methods.length === 0}
        aria-busy={pending || undefined}
        className="h-12 w-full rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] font-medium text-[var(--sf-btn-fg)] disabled:opacity-60"
      >
        {pending ? "Procesando…" : `Confirmar pedido · ${totalLabel}`}
      </button>
    </form>
  );
}
