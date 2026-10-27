"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformRole } from "@/server/auth/platform";
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
