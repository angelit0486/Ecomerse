import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ThemeSettingsV1, type ThemeSettings } from "@/lib/theme/schema";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { previewUrl } from "@/server/storefront/preview-url";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { publicMediaUrl } from "@/server/catalog/queries";

import { BrandForm } from "../apariencia/forms";
import { ProfileForm } from "./forms";
import { LaunchButton, ManualPaymentForm } from "./launch-forms";
import { LogoForm, type LogoCandidate } from "./logo-form";

export const metadata: Metadata = { title: "Configura tu tienda" };

type Props = { params: Promise<{ storeHandle: string }> };

const TIMEZONES = [
  "America/Mexico_City",
  "America/Monterrey",
  "America/Cancun",
  "America/Mazatlan",
  "America/Hermosillo",
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

interface LaunchIssue {
  code: string;
  message: string;
}

/** Dónde se resuelve cada pendiente del checklist (§14.3). */
function issueHref(base: string, code: string): string {
  if (code === "payment_method") return "#paso-pagos";
  if (code === "contact") return "#paso-datos";
  if (code === "active_product") return `${base}/productos`;
  if (code === "shipping_zone") return `${base}/envios`;
  if (code === "compliance_profile") return `${base}/ajustes/cumplimiento`;
  return `${base}/contenido`;
}

export default async function OnboardingPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  const canEditProfile = hasPermission(ctx, "store.update");
  const canEditBranding = hasPermission(ctx, "appearance.manage");
  const canManagePayments = hasPermission(ctx, "payments.manage");
  if (!canEditProfile && !canEditBranding) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: store }, { data: theme }, { data: domain }, { data: logoMedia }] =
    await Promise.all([
      supabase
        .from("stores")
        .select("name, contact_email, contact_phone, timezone")
        .eq("id", ctx.store.id)
        .single(),
      supabase
        .from("store_themes")
        .select("settings, draft_settings, logo_media_id, draft_logo_media_id, draft_revision")
        .eq("store_id", ctx.store.id)
        .maybeSingle(),
      supabase
        .from("store_domains")
        .select("hostname")
        .eq("store_id", ctx.store.id)
        .eq("is_primary", true)
        .maybeSingle(),
      supabase
        .from("media")
        .select("id, status, storage_path")
        .eq("store_id", ctx.store.id)
        .eq("owner_type", "store_branding")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
  const [{ data: checklist, error: checklistError }, { data: manual }] = await Promise.all([
    supabase.rpc("stores_launch_checklist", { p_store_id: ctx.store.id }),
    hasPermission(ctx, "payments.read")
      ? supabase
          .from("payment_accounts")
          .select("display_name, status, public_config")
          .eq("store_id", ctx.store.id)
          .eq("provider", "manual")
          .order("created_at")
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (checklistError) throw checklistError;
  const launch = checklist as { status: string; issues: LaunchIssue[] };
  const issues = launch.issues;
  const paymentsDone = !issues.some((i) => i.code === "payment_method");
  const launched = launch.status === "active";
  const logos: Array<LogoCandidate & { path: string }> = (
    (logoMedia ?? []) as { id: string; status: LogoCandidate["status"]; storage_path: string }[]
  ).map((m) => ({
    id: m.id,
    status: m.status,
    path: m.storage_path,
    url: m.status === "ready" ? publicMediaUrl(m.storage_path) : null,
  }));
  // El borrador manda; sin borrador, el logo publicado.
  const currentLogoId = theme?.draft_settings ? theme?.draft_logo_media_id : theme?.logo_media_id;
  let currentLogo = logos.find((l) => l.id === currentLogoId && l.url);
  if (!currentLogo && currentLogoId) {
    // El logo vigente puede ser más antiguo que las últimas subidas.
    const { data: row } = await supabase
      .from("media")
      .select("id, status, storage_path")
      .eq("store_id", ctx.store.id)
      .eq("id", currentLogoId)
      .eq("status", "ready")
      .is("deleted_at", null)
      .maybeSingle();
    if (row) {
      currentLogo = {
        id: row.id,
        status: "ready",
        path: row.storage_path,
        url: publicMediaUrl(row.storage_path),
      };
    }
  }
  // Mismo análisis que Apariencia: el formulario de marca es el mismo.
  const parsedSettings = ThemeSettingsV1.safeParse(theme?.draft_settings ?? theme?.settings ?? {});
  const settings: ThemeSettings = parsedSettings.success ? parsedSettings.data : {};
  const brandingSaved = Boolean(
    theme?.draft_settings || (theme?.settings as ThemeSettings)?.colors,
  );
  const profileDone = Boolean(store?.contact_email);

  const steps = [
    { title: "Cuenta y verificación en dos pasos", done: true },
    { title: "Datos de la tienda y marca", done: profileDone && brandingSaved },
    { title: "Pagos", done: paymentsDone },
    { title: "Publicar", done: launched },
  ];

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Configura tu tienda</h1>
        <div className="space-y-1">
          <p className="text-sm font-medium" id="avance-configuracion">
            {steps.filter((s) => s.done).length} de {steps.length} pasos listos
          </p>
          <progress
            aria-labelledby="avance-configuracion"
            max={steps.length}
            value={steps.filter((s) => s.done).length}
            className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-success [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-success"
          />
        </div>
        <ol className="grid gap-2 sm:grid-cols-4" aria-label="Pasos de configuración">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-md border border-border p-3 text-sm">
              <span className="block text-[13px] text-fg-muted">Paso {i + 1}</span>
              <span className="font-medium">{step.title}</span>
              <span className={`block text-[13px] ${step.done ? "text-success" : "text-fg-muted"}`}>
                {step.done ? "✓ Listo" : "Pendiente"}
              </span>
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
        <section aria-labelledby="paso-logo" className="space-y-3">
          <h2 id="paso-logo" className="text-base font-semibold">
            Logo
          </h2>
          <LogoForm
            storeHandle={ctx.store.handle}
            storeName={ctx.store.name}
            current={currentLogo ? { id: currentLogo.id, url: currentLogo.url! } : null}
            revision={theme?.draft_revision ?? 0}
            candidates={logos.map(({ id, status, url }) => ({ id, status, url }))}
          />
        </section>
      ) : null}

      {canEditBranding ? (
        <section aria-labelledby="paso-marca" className="space-y-3">
          <h2 id="paso-marca" className="text-base font-semibold">
            Estilo, colores y botones
          </h2>
          <p className="text-sm text-fg-muted">
            Elige un estilo con un clic y ajústalo. Se publica junto con tu tienda; después lo
            cambias cuando quieras en Apariencia.
          </p>
          <BrandForm
            storeHandle={ctx.store.handle}
            storeName={ctx.store.name}
            settings={settings}
            revision={theme?.draft_revision ?? 0}
          />
        </section>
      ) : null}

      <section
        aria-labelledby="paso-pagos"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <h2 id="paso-pagos" className="text-base font-semibold">
          Pagos
        </h2>
        <p className="text-sm text-fg-muted">
          {paymentsDone
            ? "Tu tienda ya tiene un método de pago activo."
            : "Activa al menos un método de pago para poder publicar."}{" "}
          Con transferencia, tú confirmas cada pago desde Pedidos.{" "}
          {canManagePayments ? (
            <>
              Para cobrar con tarjeta, conecta Mercado Pago o Stripe en{" "}
              <a className="underline" href={`/admin/${ctx.store.handle}/ajustes/pagos`}>
                Ajustes → Pagos
              </a>
              .
            </>
          ) : (
            "Los métodos de pago los activa quien administra la tienda."
          )}
        </p>
        {canManagePayments ? (
          <ManualPaymentForm
            storeHandle={ctx.store.handle}
            initial={{
              display_name:
                (manual?.display_name as string | undefined) ?? "Transferencia bancaria",
              instructions:
                (manual?.public_config as { instructions?: string } | undefined)?.instructions ??
                "",
              active: manual ? manual.status === "active" : true,
            }}
          />
        ) : (
          <p className="text-sm">Pide a un administrador de la tienda que configure los pagos.</p>
        )}
      </section>

      <section
        aria-labelledby="paso-publicar"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <h2 id="paso-publicar" className="text-base font-semibold">
          Publicar
        </h2>
        {launched ? (
          <p className="text-sm">Tu tienda está publicada y los compradores ya pueden verla.</p>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              Mientras haya pendientes, la tienda queda en borrador y nadie puede comprar.
            </p>
            {issues.length > 0 ? (
              <ul
                className="list-disc space-y-1 pl-5 text-sm"
                aria-label="Pendientes para publicar"
              >
                {issues.map((issue) => (
                  <li key={issue.code}>
                    <a
                      className="underline"
                      href={issueHref(`/admin/${ctx.store.handle}`, issue.code)}
                    >
                      {issue.message}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">Todo listo para publicar.</p>
            )}
            {canEditProfile ? (
              <LaunchButton storeHandle={ctx.store.handle} ready={issues.length === 0} />
            ) : null}
          </>
        )}
        {domain?.hostname && !launched ? (
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
