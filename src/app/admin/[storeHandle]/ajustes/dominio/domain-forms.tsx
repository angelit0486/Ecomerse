"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";

import { FormFeedback } from "../../_shared/form-feedback";
import {
  addCustomDomain,
  checkDomain,
  removeDomain,
  rotateDomainToken,
  setPrimaryDomain,
  type DomainState,
} from "./actions";

export interface DnsTargets {
  cname: string | null;
  apexA: string | null;
}

/** Registros que la tienda copia en su registrador. */
export function DnsRecords({
  hostname,
  token,
  targets,
}: {
  hostname: string;
  token: string | null;
  targets: DnsTargets;
}) {
  // www.* va con CNAME; el dominio raíz (o cualquier otro nombre) con A.
  const apex = !hostname.startsWith("www.");
  const rows: Array<[string, string, string]> = [];
  if (token) rows.push(["TXT", `_platform-verify.${hostname}`, token]);
  if (apex && targets.apexA) rows.push(["A", hostname, targets.apexA]);
  if (!apex && targets.cname) rows.push(["CNAME", hostname, targets.cname]);
  return (
    <div className="space-y-2">
      <table className="w-full table-fixed border-collapse text-left text-[13px]">
        <caption className="sr-only">Registros DNS para {hostname}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="w-20 py-2 pr-2 font-medium">
              Tipo
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              Nombre
            </th>
            <th scope="col" className="py-2 font-medium">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([type, name, value]) => (
            <tr key={type} className="border-b border-border align-top">
              <td className="py-2 pr-2">{type}</td>
              <td className="break-all py-2 pr-2 font-mono">{name}</td>
              <td className="break-all py-2 font-mono">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!targets.cname && !targets.apexA ? (
        <p className="text-[13px] text-fg-muted">
          El registro que apunta a la tienda (CNAME o A) te lo confirma el equipo de la plataforma;
          aún no está configurado aquí.
        </p>
      ) : null}
      {!token ? (
        <p className="text-[13px] text-fg-muted">
          El código TXT se muestra una sola vez. Si no lo guardaste, genera uno nuevo.
        </p>
      ) : null}
    </div>
  );
}

export function AddDomainForm({
  storeHandle,
  targets,
}: {
  storeHandle: string;
  targets: DnsTargets;
}) {
  const [state, action, pending] = useActionState<DomainState, FormData>(
    addCustomDomain.bind(null, storeHandle),
    {},
  );
  return (
    <div className="space-y-4">
      <form action={action} className="max-w-lg space-y-3" noValidate>
        <Field
          label="Tu dominio"
          hint="Con www si así lo quieres, por ejemplo www.tutienda.mx."
          error={state.fields?.hostname}
        >
          {(c) => (
            <Input
              {...c}
              name="hostname"
              inputMode="url"
              autoComplete="off"
              defaultValue={state.ok ? "" : state.values?.hostname}
              maxLength={253}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending}>
            Agregar dominio
          </Button>
          <FormFeedback state={state} />
        </div>
      </form>
      {state.ok && state.token && state.hostname ? (
        <DnsRecords hostname={state.hostname} token={state.token} targets={targets} />
      ) : null}
    </div>
  );
}

function DomainButton({
  storeHandle,
  domainId,
  hostname,
  label,
  variant = "secondary",
  act,
  targets,
  confirm,
}: {
  storeHandle: string;
  domainId: string;
  hostname: string;
  label: string;
  variant?: "secondary" | "danger";
  act: typeof checkDomain;
  targets?: DnsTargets;
  /** Acciones destructivas: se pregunta antes de enviar. */
  confirm?: { question: string; detail?: string };
}) {
  const [state, action, pending] = useActionState<DomainState, FormData>(
    act.bind(null, storeHandle),
    {},
  );
  return (
    <div className="space-y-2">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="domain_id" value={domainId} />
        <input type="hidden" name="hostname" value={hostname} />
        {confirm ? (
          <ConfirmButton
            size="sm"
            variant={variant}
            loading={pending}
            question={confirm.question}
            detail={confirm.detail}
          >
            {label}
          </ConfirmButton>
        ) : (
          <Button type="submit" size="sm" variant={variant} loading={pending}>
            {label}
          </Button>
        )}
        <FormFeedback state={state} />
      </form>
      {state.ok && state.token && targets ? (
        <DnsRecords hostname={hostname} token={state.token} targets={targets} />
      ) : null}
    </div>
  );
}

export function DomainActions({
  storeHandle,
  domain,
  targets,
}: {
  storeHandle: string;
  domain: { id: string; hostname: string; status: string; is_primary: boolean };
  targets: DnsTargets;
}) {
  const props = { storeHandle, domainId: domain.id, hostname: domain.hostname };
  const pending = ["pending", "verifying", "failed"].includes(domain.status);
  return (
    <div className="flex flex-col gap-2">
      {pending ? (
        <>
          <DomainButton {...props} label="Verificar ahora" act={checkDomain} />
          <DomainButton
            {...props}
            label="Generar un código nuevo"
            act={rotateDomainToken}
            targets={targets}
          />
        </>
      ) : null}
      {domain.status === "active" && !domain.is_primary ? (
        <DomainButton {...props} label="Usar como principal" act={setPrimaryDomain} />
      ) : null}
      <DomainButton
        {...props}
        label={`Quitar ${domain.hostname}`}
        variant="danger"
        act={removeDomain}
        confirm={{
          question: `¿Quitar ${domain.hostname}?`,
          detail:
            "Tu tienda deja de abrir en este dominio; para volver a usarlo tendrás que agregarlo y verificarlo de nuevo.",
        }}
      />
    </div>
  );
}
