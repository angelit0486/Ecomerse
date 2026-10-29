"use client";

import { useState } from "react";

import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  LIMIT_KEYS,
  LIMIT_LABELS,
  type FeatureKey,
  type LimitKey,
} from "@/lib/billing/entitlements";
import { hasUnrenderedFieldError } from "@/lib/form-values";
import { centsToInput } from "@/lib/money/format";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { Select } from "@/ui/primitives/select";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import {
  savePlan,
  savePlanPricing,
  setOverride,
  setSubscription,
  type ConsoleState,
} from "./actions";

function Feedback({ state, rendered }: { state: ConsoleState; rendered: readonly string[] }) {
  if (state.ok)
    return (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    );
  if (state.error && hasUnrenderedFieldError(state.fields, rendered))
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  return null;
}

export interface PlanValues {
  key: string;
  name: string;
  status: string;
  sort: number;
  entitlements: Record<string, number | boolean>;
}

const PLAN_STATUS = [
  { value: "active", label: "Activo (se puede elegir)" },
  { value: "legacy", label: "Anterior (lo conservan quienes ya lo tienen)" },
  { value: "hidden", label: "Oculto" },
];

/** Alta o edición de un plan: todos los límites son obligatorios (una clave ausente valdría 0). */
export function PlanForm({ plan }: { plan?: PlanValues }) {
  const [state, action, pending] = useSafeActionState(savePlan, {});
  const v = (key: string, fallback: string) => state.values?.[key] ?? fallback;
  const rendered = ["key", "name", "status", ...LIMIT_KEYS];
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Clave" required hint="Minúsculas, sin espacios." error={state.fields?.key}>
          {(c) =>
            plan ? (
              <>
                <Input {...c} value={plan.key} readOnly />
                <input type="hidden" name="key" value={plan.key} />
              </>
            ) : (
              <Input {...c} name="key" defaultValue={v("key", "")} autoComplete="off" />
            )
          }
        </Field>
        <Field label="Nombre" required error={state.fields?.name}>
          {(c) => <Input {...c} name="name" defaultValue={v("name", plan?.name ?? "")} />}
        </Field>
        <Field label="Estado" error={state.fields?.status}>
          {(c) => (
            <Select
              {...c}
              name="status"
              options={PLAN_STATUS}
              defaultValue={v("status", plan?.status ?? "active")}
            />
          )}
        </Field>
        <Field label="Orden en la lista">
          {(c) => (
            <Input
              {...c}
              name="sort"
              inputMode="numeric"
              defaultValue={v("sort", String(plan?.sort ?? 0))}
            />
          )}
        </Field>
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Límites</legend>
        {LIMIT_KEYS.map((key: LimitKey) => (
          <Field key={key} label={LIMIT_LABELS[key]} required error={state.fields?.[key]}>
            {(c) => (
              <Input
                {...c}
                name={key}
                inputMode="numeric"
                defaultValue={v(key, plan ? String(plan.entitlements[key] ?? "") : "")}
              />
            )}
          </Field>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Funciones incluidas</legend>
        {FEATURE_KEYS.map((key: FeatureKey) => (
          <label key={key} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <input
              type="checkbox"
              name={key}
              defaultChecked={plan?.entitlements[key] === true}
              className="h-4 w-4"
            />
            {FEATURE_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <Feedback state={state} rendered={rendered} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : plan ? "Guardar cambios" : "Crear plan"}
        </Button>
      </div>
    </form>
  );
}

const ACTIONS = [
  { value: "activate", label: "Registrar pago (activar por N días)", days: "30" },
  { value: "extend_trial", label: "Dar o extender la prueba gratis", days: "14" },
  { value: "past_due", label: "Marcar pago pendiente (con días de gracia)", days: "7" },
  { value: "change_plan", label: "Cambiar de plan", days: "" },
  { value: "pause", label: "Pausar (panel en solo lectura)", days: "" },
  { value: "cancel", label: "Cancelar la suscripción", days: "" },
];

/** Cobro manual: cada acción con motivo; el plan solo se pide donde aplica. */
export function SubscriptionForm({
  organizationId,
  plans,
  currentPlan,
}: {
  organizationId: string;
  plans: { value: string; label: string }[];
  currentPlan: string | null;
}) {
  const [state, action, pending] = useSafeActionState(
    setSubscription.bind(null, organizationId),
    {},
  );
  const [choice, setChoice] = useState(state.values?.action ?? "activate");
  const meta = ACTIONS.find((a) => a.value === choice) ?? ACTIONS[0]!;
  const needsDays = meta.days !== "";
  // Sin suscripción vigente, activar o dar prueba crean una nueva y piden plan.
  const asksPlan = choice === "change_plan" || !currentPlan;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Qué hacer" required error={state.fields?.action}>
        {(c) => (
          <Select {...c} name="action" options={ACTIONS} value={choice} onValueChange={setChoice} />
        )}
      </Field>
      {asksPlan ? (
        <Field label="Plan" required error={state.fields?.plan}>
          {(c) => (
            <Select
              {...c}
              name="plan"
              options={plans}
              defaultValue={state.values?.plan ?? currentPlan ?? undefined}
            />
          )}
        </Field>
      ) : null}
      {needsDays ? (
        <Field label="Días" required error={state.fields?.days}>
          {(c) => (
            <Input
              {...c}
              key={choice}
              name="days"
              inputMode="numeric"
              defaultValue={state.values?.days ?? meta.days}
            />
          )}
        </Field>
      ) : null}
      <Field
        label="Motivo"
        required
        hint="Queda en la auditoría (ej. «Pagó noviembre por transferencia»)."
        error={state.fields?.reason}
      >
        {(c) => <Input {...c} name="reason" defaultValue={state.values?.reason ?? ""} />}
      </Field>
      <Feedback state={state} rendered={["action", "plan", "days", "reason"]} />
      <div>
        <Button
          type="submit"
          variant={choice === "cancel" || choice === "pause" ? "danger" : "primary"}
          disabled={pending}
        >
          {pending ? "Guardando…" : "Aplicar"}
        </Button>
      </div>
    </form>
  );
}

/** Excepción de un límite o función para una organización (vacío = quitarla). */
export function OverrideForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useSafeActionState(setOverride.bind(null, organizationId), {});
  const [key, setKey] = useState(state.values?.key ?? "max_products");
  const isFeature = (FEATURE_KEYS as readonly string[]).includes(key);
  const options = [
    ...LIMIT_KEYS.map((k) => ({ value: k, label: LIMIT_LABELS[k] })),
    ...FEATURE_KEYS.map((k) => ({ value: k, label: FEATURE_LABELS[k] })),
  ];
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Límite o función" required error={state.fields?.key}>
          {(c) => <Select {...c} name="key" options={options} value={key} onValueChange={setKey} />}
        </Field>
        <Field
          label="Valor"
          hint="Déjalo vacío para quitar la excepción."
          error={state.fields?.value}
        >
          {(c) =>
            isFeature ? (
              <Select
                {...c}
                key={key}
                name="value"
                placeholder="Quitar la excepción"
                options={[
                  { value: "", label: "Quitar la excepción" },
                  { value: "si", label: "Sí" },
                  { value: "no", label: "No" },
                ]}
                defaultValue=""
              />
            ) : (
              <Input
                {...c}
                key={key}
                name="value"
                inputMode="numeric"
                defaultValue={state.values?.value ?? ""}
              />
            )
          }
        </Field>
        <Field label="Vence el" hint="Opcional." error={state.fields?.expires_at}>
          {(c) => (
            <Input
              {...c}
              type="date"
              name="expires_at"
              defaultValue={state.values?.expires_at ?? ""}
            />
          )}
        </Field>
        <Field label="Motivo" required error={state.fields?.reason}>
          {(c) => <Input {...c} name="reason" defaultValue={state.values?.reason ?? ""} />}
        </Field>
      </div>
      <Feedback state={state} rendered={["key", "value", "expires_at", "reason"]} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Guardando…" : "Guardar excepción"}
        </Button>
      </div>
    </form>
  );
}

export interface PlanPricing {
  key: string;
  name: string;
  price_monthly: number | null;
  price_annual: number | null;
  trial_days: number | null;
}

/** Precios del plan (ADR-044). Vacío = sin precio: no se cobra ni cuenta en el MRR. */
export function PlanPricingForm({ plan }: { plan: PlanPricing }) {
  const [state, action, pending] = useSafeActionState(savePlanPricing.bind(null, plan.key), {});
  const v = (key: string, fallback: string) => state.values?.[key] ?? fallback;
  const rendered = ["price_monthly", "price_annual", "trial_days"];
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={`Precio mensual de ${plan.name}`}
          hint="En pesos, IVA según tu contrato."
          error={state.fields?.price_monthly}
        >
          {(c) => (
            <Input
              {...c}
              name="price_monthly"
              inputMode="decimal"
              defaultValue={v("price_monthly", centsToInput(plan.price_monthly))}
            />
          )}
        </Field>
        <Field label={`Precio anual de ${plan.name}`} error={state.fields?.price_annual}>
          {(c) => (
            <Input
              {...c}
              name="price_annual"
              inputMode="decimal"
              defaultValue={v("price_annual", centsToInput(plan.price_annual))}
            />
          )}
        </Field>
        <Field label={`Días de prueba de ${plan.name}`} error={state.fields?.trial_days}>
          {(c) => (
            <Input
              {...c}
              name="trial_days"
              inputMode="numeric"
              defaultValue={v(
                "trial_days",
                plan.trial_days === null ? "" : String(plan.trial_days),
              )}
            />
          )}
        </Field>
      </div>
      <Feedback state={state} rendered={rendered} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar precios"}
        </Button>
      </div>
    </form>
  );
}
