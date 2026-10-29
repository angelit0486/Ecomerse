"use server";

import { revalidatePath } from "next/cache";
import { parseMoneyToCents } from "@/lib/money/format";

import { requirePlatformRole } from "@/server/auth/platform";
import { FEATURE_KEYS, LIMIT_KEYS } from "@/lib/billing/entitlements";
import { formValues } from "@/lib/form-values";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { processQueueSoon } from "@/server/jobs/run-now";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Acciones de la consola de plataforma. La autorización real está en las RPC. */
export interface ConsoleState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

const FIELD_TEXT: Record<string, string> = {
  plan: "Elige un plan activo.",
  trial_days: "Días de prueba entre 0 y 90.",
  minutes: "Elige una duración de hasta 60 minutos.",
  grantee: "Elige a alguien del equipo de soporte.",
  ticket_ref: "El ticket admite hasta 100 caracteres.",
  status: "Estado inválido.",
};

async function attempt(
  work: () => Promise<string>,
  revalidate: string | null,
  options: { fieldText?: Record<string, string>; conflictMessage?: string } = {},
): Promise<ConsoleState> {
  let message: string;
  try {
    await requirePlatformRole();
    message = await work();
  } catch (error) {
    const appError = reportActionError("platform", error);
    const texts = { ...FIELD_TEXT, ...options.fieldText };
    const fields = appError.fields
      ? Object.fromEntries(
          Object.keys(appError.fields).map((k) => [k, texts[k] ?? "Revisa este dato."]),
        )
      : undefined;
    const errorMessage =
      appError.code === "conflict" && options.conflictMessage
        ? options.conflictMessage
        : appError.message;
    return { error: errorMessage, ...(fields ? { fields } : {}) };
  }
  if (revalidate) revalidatePath(revalidate);
  return { ok: true, message };
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

const TENANT_KEYS = ["org_name", "org_slug", "owner_email", "store_name", "store_handle", "plan"];
const GRANT_KEYS = ["store_id", "grantee", "minutes", "reason", "ticket_ref"];

/** Con error, devuelve lo escrito para no vaciar el formulario. */
async function keepValues(
  formData: FormData,
  keys: readonly string[],
  state: Promise<ConsoleState>,
): Promise<ConsoleState> {
  const result = await state;
  return result.ok ? result : { ...result, values: formValues(formData, keys) };
}

export async function createTenant(_: ConsoleState, formData: FormData): Promise<ConsoleState> {
  return keepValues(
    formData,
    TENANT_KEYS,
    attempt(
      async () => {
        const supabase = await createSupabaseServerClient();
        const result = await callRpc<{ hostname: string }>(
          supabase,
          "platform_create_organization_with_store",
          {
            p_org_name: text(formData, "org_name"),
            p_org_slug: text(formData, "org_slug"),
            p_org_country: text(formData, "country") || "MX",
            p_owner_email: text(formData, "owner_email"),
            p_store_name: text(formData, "store_name"),
            p_store_handle: text(formData, "store_handle"),
            p_plan_key: text(formData, "plan"),
          },
        );
        return `Tienda creada en ${result.hostname}. Enviamos la invitación al dueño.`;
      },
      "/platform",
      {
        conflictMessage: "Ya existe una organización con ese slug o una tienda con esa dirección.",
      },
    ),
  );
}

const STORE_KEYS = ["store_name", "store_handle"];

/** Otra tienda en una organización existente; la plataforma la crea (E15 no aprobada). */
export async function addStore(
  organizationId: string,
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  return keepValues(
    formData,
    STORE_KEYS,
    attempt(
      async () => {
        const supabase = await createSupabaseServerClient();
        const result = await callRpc<{ hostname: string }>(supabase, "platform_add_store", {
          p_org_id: organizationId,
          p_store_name: text(formData, "store_name"),
          p_store_handle: text(formData, "store_handle"),
        });
        return `Tienda creada en ${result.hostname}. La dueña ya la ve en su selector de tiendas; ahí elige una plantilla en «Configura tu tienda» o copia el diseño de otra de sus tiendas en Apariencia.`;
      },
      "/platform",
      {
        conflictMessage: "Ya existe una tienda con esa dirección. Elige otra.",
        fieldText: { organization_status: "La organización no está activa." },
      },
    ),
  );
}

export async function setOrganizationStatus(
  organizationId: string,
  status: "active" | "suspended",
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  return attempt(
    async () => {
      const supabase = await createSupabaseServerClient();
      await callRpc(supabase, "platform_set_tenant_status", {
        p_organization_id: organizationId,
        p_status: status,
        p_reason: text(formData, "reason"),
      });
      return status === "suspended" ? "Organización suspendida." : "Organización reactivada.";
    },
    "/platform",
    { fieldText: { reason: "Escribe un motivo (mínimo 10 caracteres)." } },
  );
}

export async function grantSupport(_: ConsoleState, formData: FormData): Promise<ConsoleState> {
  return keepValues(
    formData,
    GRANT_KEYS,
    attempt(
      async () => {
        const supabase = await createSupabaseServerClient();
        await callRpc(supabase, "platform_grant_support_access", {
          p_store_id: text(formData, "store_id"),
          p_grantee_user_id: text(formData, "grantee"),
          p_reason: text(formData, "reason"),
          p_minutes: Number(text(formData, "minutes") || 30),
          p_ticket_ref: text(formData, "ticket_ref") || null,
        });
        return "Acceso concedido. Avisamos al dueño de la tienda.";
      },
      "/platform/soporte",
      { fieldText: { reason: "Escribe un motivo (mínimo 20 caracteres)." } },
    ),
  );
}

export async function revokeSupport(grantId: string): Promise<ConsoleState> {
  return attempt(async () => {
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "platform_revoke_support_access", { p_grant_id: grantId });
    return "Acceso revocado.";
  }, "/platform/soporte");
}

/** Vuelve a la cola un trabajo fallido (paso 17). La base exige rol de dueño o administración. */
export async function retryDeadJob(jobId: string): Promise<ConsoleState> {
  return attempt(
    async () => {
      const supabase = await createSupabaseServerClient();
      await callRpc(supabase, "platform_retry_dead_job", { p_job_id: jobId });
      processQueueSoon("platform.retry_job");
      return "Trabajo de vuelta en la cola.";
    },
    // Sin refrescar: el trabajo sale de la lista y se llevaría su propia confirmación.
    null,
    { conflictMessage: "Ese trabajo ya no está fallido." },
  );
}

const PLAN_KEYS = ["key", "name", "status", "sort", ...LIMIT_KEYS, ...FEATURE_KEYS];

/** Crea o edita un plan con todos sus límites (F10). La base exige dueño o administración. */
export async function savePlan(_: ConsoleState, formData: FormData): Promise<ConsoleState> {
  const entitlements: Record<string, number | boolean | null> = {};
  for (const key of LIMIT_KEYS) {
    const raw = text(formData, key);
    // Vacío o no numérico va como null y la base responde con el campo exacto.
    entitlements[key] = raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);
  }
  for (const key of FEATURE_KEYS) entitlements[key] = formData.get(key) === "on";
  return keepValues(
    formData,
    PLAN_KEYS,
    attempt(
      async () => {
        const supabase = await createSupabaseServerClient();
        await callRpc(supabase, "platform_save_plan", {
          p_key: text(formData, "key"),
          p_name: text(formData, "name"),
          p_status: text(formData, "status") || "active",
          p_sort: Number(text(formData, "sort") || 0),
          p_entitlements: entitlements,
        });
        return "Plan guardado.";
      },
      "/platform/planes",
      {
        fieldText: {
          key: "Clave en minúsculas, sin espacios (ej. basico).",
          name: "Escribe un nombre de hasta 60 caracteres.",
          ...Object.fromEntries(LIMIT_KEYS.map((k) => [k, "Escribe un número entero (0 o más)."])),
        },
      },
    ),
  );
}

/**
 * Precios de un plan (ADR-044): mensual y anual en pesos con centavos, y días de
 * prueba. Vacío = sin precio (no cuenta en el MRR). La base exige dueño o administración.
 */
export async function savePlanPricing(
  planKey: string,
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  const keys = ["price_monthly", "price_annual", "trial_days"];
  const fields: Record<string, string> = {};
  const money = (key: string) => {
    const raw = text(formData, key);
    if (raw === "") return null;
    const cents = parseMoneyToCents(raw);
    if (cents === null) fields[key] = "Escribe un importe como 499 o 499.00.";
    return cents;
  };
  const monthly = money("price_monthly");
  const annual = money("price_annual");
  const trialRaw = text(formData, "trial_days");
  const trial = trialRaw === "" ? null : Number(trialRaw);
  if (trial !== null && (!Number.isInteger(trial) || trial < 0 || trial > 90)) {
    fields.trial_days = "Escribe de 0 a 90 días.";
  }
  if (Object.keys(fields).length > 0) {
    return { error: "Revisa los datos marcados.", fields, values: formValues(formData, keys) };
  }
  return keepValues(
    formData,
    keys,
    attempt(
      async () => {
        const supabase = await createSupabaseServerClient();
        await callRpc(supabase, "platform_set_plan_pricing", {
          p_key: planKey,
          p_price_monthly: monthly,
          p_price_annual: annual,
          p_trial_days: trial,
        });
        return "Precios guardados.";
      },
      "/platform/planes",
      {
        fieldText: {
          price_monthly: "Escribe un importe de 0 a 1,000,000.",
          price_annual: "Escribe un importe de 0 a 10,000,000.",
          trial_days: "Escribe de 0 a 90 días.",
        },
      },
    ),
  );
}

const SUBSCRIPTION_MESSAGES: Record<string, string> = {
  activate: "Pago registrado: la suscripción está activa.",
  extend_trial: "Prueba extendida.",
  past_due: "Marcada con pago pendiente.",
  pause: "Suscripción pausada: el panel queda en solo lectura.",
  cancel: "Suscripción cancelada.",
  change_plan: "Plan cambiado.",
};

/** Cobro manual (§19.5): cada cambio lleva motivo y queda en la auditoría. */
export async function setSubscription(
  organizationId: string,
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  const action = text(formData, "action");
  const days = text(formData, "days");
  return keepValues(
    formData,
    ["action", "plan", "days", "reason"],
    attempt(
      async () => {
        const supabase = await createSupabaseServerClient();
        await callRpc(supabase, "platform_set_subscription", {
          p_organization_id: organizationId,
          p_action: action,
          p_plan_key: text(formData, "plan") || null,
          p_days: days ? Number(days) : null,
          p_reason: text(formData, "reason"),
        });
        return SUBSCRIPTION_MESSAGES[action] ?? "Suscripción actualizada.";
      },
      `/platform/organizaciones/${organizationId}`,
      {
        conflictMessage:
          "Esta organización no tiene suscripción vigente: actívala o dale una prueba con un plan.",
        fieldText: {
          reason: "Escribe un motivo (mínimo 5 caracteres).",
          days: "Escribe de 1 a 400 días.",
          action: "Elige qué hacer.",
        },
      },
    ),
  );
}

/** Excepción de un límite para una organización; valor vacío la quita. */
export async function setOverride(
  organizationId: string,
  _: ConsoleState,
  formData: FormData,
): Promise<ConsoleState> {
  const key = text(formData, "key");
  const raw = text(formData, "value");
  const isFeature = (FEATURE_KEYS as readonly string[]).includes(key);
  const value = raw === "" ? null : isFeature ? raw === "si" : Number(raw);
  const expires = text(formData, "expires_at");
  return keepValues(
    formData,
    ["key", "value", "expires_at", "reason"],
    attempt(
      async () => {
        const supabase = await createSupabaseServerClient();
        await callRpc(supabase, "platform_set_entitlement_override", {
          p_organization_id: organizationId,
          p_key: key,
          p_value: value,
          // Fin del día en la Ciudad de México (UTC−6 todo el año desde 2022).
          p_expires_at: expires ? new Date(`${expires}T23:59:59-06:00`).toISOString() : null,
          p_reason: text(formData, "reason"),
        });
        return value === null ? "Excepción quitada." : "Excepción guardada.";
      },
      `/platform/organizaciones/${organizationId}`,
      {
        fieldText: {
          key: "Elige un límite o función.",
          value: isFeature ? "Elige sí o no." : "Escribe un número entero (0 o más).",
          expires_at: "La fecha debe ser futura.",
          reason: "Escribe un motivo (mínimo 5 caracteres).",
        },
      },
    ),
  );
}
