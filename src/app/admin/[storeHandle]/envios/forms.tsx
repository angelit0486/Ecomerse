"use client";

import { useState } from "react";

import { MX_STATES } from "@/lib/checkout/mx-states";
import { isMexicoOnly, mxStateName } from "@/lib/shipping/regions";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import type { FormState } from "../_shared/action-state";
import { FormFeedback } from "../_shared/form-feedback";
import { nativeControl } from "../productos/styles";
import { deleteRate, deleteZone, quickNationalShipping, saveRate, saveZone } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function ZoneForm({
  storeHandle,
  zone,
}: {
  storeHandle: string;
  zone?: { id: string; name: string; countries: string[]; regions: string[] | null };
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveZone.bind(null, storeHandle),
    {},
  );
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  const p = zone ? `zone-${zone.id}` : "zone-new";
  const [countries, setCountries] = useState(() =>
    v("countries", zone?.countries.join(", ") ?? "MX"),
  );
  const mexico = isMexicoOnly(
    countries
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr] sm:items-end" noValidate>
      {zone ? <input type="hidden" name="id" value={zone.id} /> : null}
      <Field
        label={zone ? `Nombre de la zona ${zone.name}` : "Nombre de la zona"}
        id={`${p}-name`}
        required
        error={state.fields?.name}
      >
        {(c) => (
          <Input {...c} name="name" defaultValue={v("name", zone?.name ?? "")} maxLength={80} />
        )}
      </Field>
      <Field
        label="Países"
        id={`${p}-countries`}
        hint="Códigos de dos letras, p. ej. MX"
        error={state.fields?.countries}
      >
        {(c) => (
          <Input
            {...c}
            name="countries"
            value={countries}
            onChange={(e) => setCountries(e.target.value)}
          />
        )}
      </Field>
      {mexico ? (
        <StatePicker
          id={`${p}-regions`}
          initial={v("regions", zone?.regions?.join(", ") ?? "")}
          error={state.fields?.regions}
        />
      ) : (
        <div className="sm:col-span-2">
          <Field
            label="Regiones (opcional)"
            id={`${p}-regions`}
            hint="Vacío = todo el país"
            error={state.fields?.regions}
          >
            {(c) => (
              <Input
                {...c}
                name="regions"
                defaultValue={v("regions", zone?.regions?.join(", ") ?? "")}
              />
            )}
          </Field>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" variant={zone ? "secondary" : "primary"} loading={pending}>
          {zone ? "Guardar zona" : "Crear zona"}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function DeleteButton({
  storeHandle,
  kind,
  id,
  label,
}: {
  storeHandle: string;
  kind: "zone" | "rate";
  id: string;
  label: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    (kind === "zone" ? deleteZone : deleteRate).bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <ConfirmButton
        size="sm"
        loading={pending}
        aria-label={`Eliminar ${label}`}
        question={`¿Eliminar ${label}?`}
        detail={kind === "zone" ? "También se eliminan sus tarifas." : undefined}
      >
        Eliminar
      </ConfirmButton>
      <FormFeedback state={state} />
    </form>
  );
}

export interface RateValues {
  id: string;
  zone_id: string;
  name: string;
  type: "flat" | "free_over" | "pickup";
  price: string;
  free_over_subtotal: string;
  est_days_min: string;
  est_days_max: string;
  is_active: boolean;
}

export function RateForm({
  storeHandle,
  zoneId,
  rate,
  currency,
}: {
  storeHandle: string;
  zoneId: string;
  rate?: RateValues;
  currency: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveRate.bind(null, storeHandle),
    {},
  );
  const [type, setType] = useState(rate?.type ?? "flat");
  const v = (k: keyof RateValues, d: string) => state.values?.[k] ?? d;
  const p = rate ? `rate-${rate.id}` : `rate-new-${zoneId}`;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end" noValidate>
      {rate ? <input type="hidden" name="id" value={rate.id} /> : null}
      <input type="hidden" name="zone_id" value={zoneId} />
      <Field
        label={rate ? `Nombre de la tarifa ${rate.name}` : "Nombre de la tarifa"}
        id={`${p}-name`}
        required
      >
        {(c) => (
          <Input {...c} name="name" defaultValue={v("name", rate?.name ?? "")} maxLength={80} />
        )}
      </Field>
      <Field label="Tipo" id={`${p}-type`}>
        {(c) => (
          <select
            {...c}
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as RateValues["type"])}
            className={nativeControl}
          >
            <option value="flat">Precio fijo</option>
            <option value="free_over">Gratis desde un monto</option>
            <option value="pickup">Recoger en tienda</option>
          </select>
        )}
      </Field>
      {type !== "pickup" ? (
        <Field label={`Precio (${currency})`} id={`${p}-price`}>
          {(c) => (
            <Input
              {...c}
              name="price"
              defaultValue={v("price", rate?.price ?? "")}
              inputMode="decimal"
            />
          )}
        </Field>
      ) : null}
      {type === "free_over" ? (
        <Field label={`Gratis desde (${currency})`} id={`${p}-free`}>
          {(c) => (
            <Input
              {...c}
              name="free_over_subtotal"
              defaultValue={v("free_over_subtotal", rate?.free_over_subtotal ?? "")}
              inputMode="decimal"
            />
          )}
        </Field>
      ) : null}
      <Field label="Días (mín.)" id={`${p}-dmin`}>
        {(c) => (
          <Input
            {...c}
            name="est_days_min"
            defaultValue={v("est_days_min", rate?.est_days_min ?? "")}
            inputMode="numeric"
          />
        )}
      </Field>
      <Field label="Días (máx.)" id={`${p}-dmax`}>
        {(c) => (
          <Input
            {...c}
            name="est_days_max"
            defaultValue={v("est_days_max", rate?.est_days_max ?? "")}
            inputMode="numeric"
          />
        )}
      </Field>
      <label className="flex h-11 md:h-9 items-center gap-2 text-sm">
        <input type="hidden" name="is_active" value="0" />
        <input
          type="checkbox"
          name="is_active"
          value="1"
          defaultChecked={state.values ? state.values.is_active === "1" : (rate?.is_active ?? true)}
        />
        Activa
      </label>
      <Button type="submit" size="sm" variant={rate ? "secondary" : "primary"} loading={pending}>
        {rate ? "Guardar tarifa" : "Agregar tarifa"}
      </Button>
      <div className="sm:col-span-4">
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

/**
 * Estados de una zona de México: se eligen de la lista (los mismos nombres que
 * usa el checkout), así una zona nunca deja de aplicar por un error de dedo.
 * Ninguno marcado = todo el país.
 */
function StatePicker({ id, initial, error }: { id: string; initial: string; error?: string }) {
  const [chosen, setChosen] = useState<Set<string>>(
    () =>
      new Set(
        initial
          .split(",")
          .map((x) => mxStateName(x))
          .filter((x): x is (typeof MX_STATES)[number] => x !== null),
      ),
  );
  const summary =
    chosen.size === 0
      ? "Todo el país"
      : chosen.size <= 3
        ? [...chosen].join(", ")
        : `${chosen.size} estados`;
  return (
    <fieldset
      className="min-w-0 space-y-1 sm:col-span-2"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="text-[13px] font-medium">Estados</legend>
      <details className="rounded-[var(--radius-control)] border border-control bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm md:min-h-9">
          {summary}
        </summary>
        <div className="space-y-2 border-t border-border p-3">
          <p className="text-[13px] text-fg-muted">
            Sin marcar ninguno, la zona cubre todo México.
          </p>
          <div className="grid max-h-72 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {MX_STATES.map((state) => (
              <label key={state} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
                <input
                  type="checkbox"
                  name="region"
                  value={state}
                  checked={chosen.has(state)}
                  onChange={(e) =>
                    setChosen((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(state);
                      else next.delete(state);
                      return next;
                    })
                  }
                />
                {state}
              </label>
            ))}
          </div>
        </div>
      </details>
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** «Envío a todo México» en un paso: zona, tarifa estándar y, si quieres, envío gratis. */
export function QuickNationalForm({
  storeHandle,
  currency,
  hasZones,
}: {
  storeHandle: string;
  currency: string;
  /** Con zonas ya no se ofrece; queda montado para que su «Listo» no desaparezca. */
  hasZones: boolean;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    quickNationalShipping.bind(null, storeHandle),
    {},
  );
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  if (hasZones) {
    return state.ok ? (
      <p role="status" className="rounded-md border border-success px-3 py-2 text-sm text-success">
        {state.message} Abajo puedes ajustar sus tarifas o agregar zonas por estado.
      </p>
    ) : null;
  }
  return (
    <form
      action={action}
      noValidate
      className="space-y-3 rounded-md border border-accent bg-surface p-4"
      aria-labelledby="envio-nacional"
    >
      <div className="space-y-1">
        <h2 id="envio-nacional" className="text-base font-semibold">
          Envía a todo México en un paso
        </h2>
        <p className="text-sm text-fg-muted">
          Crea la zona «Todo México» con un costo de envío. Después puedes agregar zonas con otro
          precio para algunos estados.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <Field
          label={`Costo del envío (${currency})`}
          id="qn-price"
          required
          error={state.fields?.price}
        >
          {(c) => <Input {...c} name="price" inputMode="decimal" defaultValue={v("price", "")} />}
        </Field>
        <Field
          label={`Gratis desde (${currency})`}
          id="qn-free"
          hint="Opcional"
          error={state.fields?.free_over_subtotal}
        >
          {(c) => (
            <Input
              {...c}
              name="free_over_subtotal"
              inputMode="decimal"
              defaultValue={v("free_over_subtotal", "")}
            />
          )}
        </Field>
        <Field label="Llega en (días mín.)" id="qn-dmin" error={state.fields?.days}>
          {(c) => (
            <Input
              {...c}
              name="est_days_min"
              inputMode="numeric"
              defaultValue={v("est_days_min", "3")}
            />
          )}
        </Field>
        <Field label="Días máx." id="qn-dmax">
          {(c) => (
            <Input
              {...c}
              name="est_days_max"
              inputMode="numeric"
              defaultValue={v("est_days_max", "7")}
            />
          )}
        </Field>
      </div>
      <Button type="submit" loading={pending}>
        Crear envío a todo México
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
