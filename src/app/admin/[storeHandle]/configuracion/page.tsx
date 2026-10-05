import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolvePalette, type Palette } from "@/lib/theme/palette";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { serverEnv } from "@/server/env";
import { createPreviewToken } from "@/server/storefront/preview";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { BrandingForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Configura tu tienda" };

type Props = { params: Promise<{ storeHandle: string }> };

const TIMEZONES = [
  "America/Mexico_City",
  "America/Monterrey",
  "America/Cancun",
  "America/Chihuahua",
  "America/Tijuana",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "America/New_York",
  "Europe/Madrid",
];

interface ThemeSettings {
  colors?: Partial<Palette>;
  shape?: { radius?: string; button_style?: string };
}

/** Enlace de vista previa del borrador en el dominio de la tienda (CF-09). */
function previewUrl(hostname: string, storeId: string): string {
  const env = serverEnv();
  const secure = env.APP_ENV === "production" || env.APP_ENV === "preview";
  const port = env.APP_HOSTNAME.split(":")[1];
  const origin = `${secure ? "https" : "http"}://${hostname}${!secure && port ? `:${port}` : ""}`;
  const token = createPreviewToken(env.PREVIEW_HMAC_SECRET, storeId, Math.floor(Date.now() / 1000));
  return `${origin}/_preview?token=${token}`;
}

export default async function OnboardingPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  const canEditProfile = hasPermission(ctx, "store.update");
  const canEditBranding = hasPermission(ctx, "appearance.manage");
  if (!canEditProfile && !canEditBranding) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: store }, { data: theme }, { data: domain }] = await Promise.all([
    supabase
      .from("stores")
      .select("name, contact_email, contact_phone, timezone")
      .eq("id", ctx.store.id)
      .single(),
    supabase
      .from("store_themes")
      .select("settings, draft_settings")
      .eq("store_id", ctx.store.id)
      .maybeSingle(),
    supabase
      .from("store_domains")
      .select("hostname")
      .eq("store_id", ctx.store.id)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);
  const settings = (theme?.draft_settings ?? theme?.settings ?? {}) as ThemeSettings;
  const brandingSaved = Boolean(
    theme?.draft_settings || (theme?.settings as ThemeSettings)?.colors,
  );
  const profileDone = Boolean(store?.contact_email);

  const steps = [
    { title: "Cuenta y verificación en dos pasos", done: true },
    { title: "Datos de la tienda y marca", done: profileDone && brandingSaved },
    { title: "Pagos", done: false },
    { title: "Guardar en borrador", done: profileDone && brandingSaved },
  ];

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Configura tu tienda</h1>
        <ol className="grid gap-2 sm:grid-cols-4" aria-label="Pasos de configuración">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-md border border-border p-3 text-sm">
              <span className="block text-[13px] text-fg-muted">Paso {i + 1}</span>
              <span className="font-medium">{step.title}</span>
              <span className="block text-[13px]">{step.done ? "Listo" : "Pendiente"}</span>
            </li>
          ))}
        </ol>
      </header>

      {canEditProfile && store ? (
        <section aria-labelledby="paso-datos" className="space-y-3">
          <h2 id="paso-datos" className="text-base font-semibold">
            Datos de la tienda
          </h2>
          <ProfileForm
            storeHandle={ctx.store.handle}
            initial={{
              name: store.name,
              contact_email: store.contact_email ?? "",
              contact_phone: store.contact_phone ?? "",
              timezone: store.timezone,
            }}
            timezones={
              TIMEZONES.includes(store.timezone) ? TIMEZONES : [store.timezone, ...TIMEZONES]
            }
          />
        </section>
      ) : null}

      {canEditBranding ? (
        <section aria-labelledby="paso-marca" className="space-y-3">
          <h2 id="paso-marca" className="text-base font-semibold">
            Colores y botones
          </h2>
          <BrandingForm
            storeHandle={ctx.store.handle}
            storeName={ctx.store.name}
            initial={resolvePalette(settings.colors)}
            radius={settings.shape?.radius ?? "md"}
            buttonStyle={settings.shape?.button_style ?? "solid"}
          />
        </section>
      ) : null}

      <section
        aria-labelledby="paso-pagos"
        className="space-y-2 rounded-md border border-border p-4"
      >
        <h2 id="paso-pagos" className="text-base font-semibold">
          Pagos
        </h2>
        <p className="text-sm text-fg-muted">
          Conectar pagos: disponible al activar pagos. Mientras tanto tu tienda queda en borrador y
          nadie puede comprar.
        </p>
        <button
          type="button"
          disabled
          className="rounded-md border border-border px-3 py-1.5 text-sm opacity-60"
        >
          Conectar pagos (próximamente)
        </button>
      </section>

      <section
        aria-labelledby="paso-borrador"
        className="space-y-2 rounded-md border border-border p-4"
      >
        <h2 id="paso-borrador" className="text-base font-semibold">
          Guardar en borrador
        </h2>
        <p className="text-sm text-fg-muted">
          Tus cambios se guardan como borrador. La tienda no es visible para compradores hasta que
          se pueda publicar.
        </p>
        {domain?.hostname ? (
          <a
            href={previewUrl(domain.hostname, ctx.store.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm underline"
          >
            Ver vista previa de la tienda
          </a>
        ) : null}
      </section>
    </section>
  );
}
