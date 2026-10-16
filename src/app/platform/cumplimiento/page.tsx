import {
  PLACEMENT_LABELS,
  PROFILE_STATUS_LABELS,
  RULE_KIND_LABELS,
  supplementFieldLabel,
} from "@/lib/compliance/labels";
import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { SUPPLEMENT_FIELDS } from "@/server/catalog/regulatory";
import { listPlatformCompliance } from "@/server/compliance/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { ProfileStatusForm, RetireRuleButton, RuleForm } from "./compliance-forms";

export const metadata = { title: "Cumplimiento" };

const date = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "long",
  timeZone: "America/Mexico_City",
});

/**
 * Reglas regulatorias por jurisdicción (R-T02, ADR-021). Un perfil pendiente
 * bloquea la publicación de su categoría en las tiendas de ese país; marcarlo
 * como revisado exige el nombre de quien lo revisó.
 */
export default async function PlatformCompliancePage() {
  const role = await requirePlatformRole();
  const manage = canManageTenants(role);
  const supabase = await createSupabaseServerClient();
  const profiles = await listPlatformCompliance(supabase);

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Cumplimiento</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Reglas sanitarias por país y categoría. La plataforma no redacta textos legales: captura
          aquí las leyendas, los campos obligatorios y los términos prohibidos que indique el asesor
          regulatorio, y márcalas como revisadas.
        </p>
      </header>

      {profiles.map((profile) => {
        const active = profile.rules.filter((r) => r.status === "active");
        return (
          <section
            key={profile.id}
            aria-labelledby={`perfil-${profile.id}`}
            className="space-y-4 rounded-md border border-border p-4"
          >
            <header className="space-y-1">
              <h2 id={`perfil-${profile.id}`} className="font-semibold">
                {profile.category_name} · {profile.country}
              </h2>
              <p className="text-sm">
                {PROFILE_STATUS_LABELS[profile.status] ?? profile.status} · versión{" "}
                {profile.version}
                {profile.status === "active" && profile.reviewed_by && profile.reviewed_at
                  ? ` · revisó ${profile.reviewed_by} el ${date.format(new Date(profile.reviewed_at))}`
                  : ""}
              </p>
              {profile.status !== "active" ? (
                <p role="status" className="rounded-md border border-warning p-3 text-sm">
                  Mientras no esté revisado, ninguna tienda de {profile.country} puede publicar
                  productos de esta categoría.
                </p>
              ) : null}
            </header>

            <Table caption={`Reglas activas (${active.length})`}>
              <THead>
                <TR>
                  <TH>Tipo</TH>
                  <TH>Nombre</TH>
                  <TH>Contenido</TH>
                  <TH>Acciones</TH>
                </TR>
              </THead>
              <TBody>
                {active.length === 0 ? (
                  <TR>
                    <TD colSpan={4} className="text-fg-muted">
                      Sin reglas todavía.
                    </TD>
                  </TR>
                ) : (
                  active.map((rule) => (
                    <TR key={rule.id}>
                      <TD>{RULE_KIND_LABELS[rule.kind] ?? rule.kind}</TD>
                      <TD>
                        {rule.label}
                        <span className="block text-[13px] text-fg-muted">{rule.key}</span>
                      </TD>
                      <TD className="whitespace-pre-line">
                        {rule.kind === "required_field"
                          ? supplementFieldLabel(rule.field_key ?? "")
                          : rule.kind === "store_legend"
                            ? `La tienda redacta y aprueba su leyenda.${rule.body ? ` Borrador sugerido: ${rule.body}` : ""}`
                            : rule.body}
                        {rule.kind === "required_legend" || rule.kind === "store_legend" ? (
                          <span className="block text-[13px] text-fg-muted">
                            En: {rule.placements.map((p) => PLACEMENT_LABELS[p] ?? p).join(", ")}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        {manage ? <RetireRuleButton ruleId={rule.id} label={rule.label} /> : null}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>

            {manage ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <RuleForm profileId={profile.id} fieldKeys={[...SUPPLEMENT_FIELDS]} />
                <ProfileStatusForm profileId={profile.id} reviewedBy={profile.reviewed_by} />
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Tu rol solo puede consultar las reglas.</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
