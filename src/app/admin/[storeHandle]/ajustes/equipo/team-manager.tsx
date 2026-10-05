"use client";

import { useActionState, useState, useTransition } from "react";

import { hasUnrenderedFieldError } from "@/lib/form-values";
import { Button } from "@/ui/primitives/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/ui/primitives/dialog";
import { Field } from "@/ui/primitives/field";
import { Input } from "@/ui/primitives/input";
import { Select } from "@/ui/primitives/select";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";
import { ToastProvider, useToast } from "@/ui/primitives/toast";

import {
  changeMemberRole,
  inviteMember,
  removeMember,
  resetMfa,
  revokeInvitation,
  setMemberStatus,
  type TeamActionState,
} from "./actions";

export interface MemberRow {
  user_id: string;
  email: string;
  full_name: string | null;
  access: "organization" | "store";
  role_key: string;
  role_name: string | null;
  status: "active" | "suspended";
}

export interface InvitationRow {
  id: string;
  email: string;
  store_role_id: string;
  expires_at: string;
  /** Fecha formateada en el servidor (zona horaria de la tienda): sin desajuste de hidratación. */
  expires_label: string;
}

export interface RoleOption {
  value: string;
  label: string;
}

interface Props {
  storeHandle: string;
  currentUserId: string;
  canManage: boolean;
  canResetMfa: boolean;
  members: MemberRow[];
  invitations: InvitationRow[];
  roles: RoleOption[];
  roleNames: Record<string, string>;
}

const ORG_ROLE: Record<string, string> = {
  org_owner: "Dueño",
  org_admin: "Administrador de la organización",
};

export function TeamManager(props: Props) {
  return (
    <ToastProvider>
      <TeamManagerInner {...props} />
    </ToastProvider>
  );
}

function TeamManagerInner({
  storeHandle,
  currentUserId,
  canManage,
  canResetMfa,
  members,
  invitations,
  roles,
  roleNames,
}: Props) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function perform(action: () => Promise<TeamActionState>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast({ title: result.error, tone: "error" });
      else if (result.message) toast({ title: result.message, tone: "success" });
    });
  }

  return (
    <div className="space-y-8" aria-busy={pending}>
      {canManage ? <InviteDialog storeHandle={storeHandle} roles={roles} /> : null}

      <Table caption="Miembros con acceso a la tienda">
        <THead>
          <TR>
            <TH>Persona</TH>
            <TH>Rol</TH>
            <TH>Estado</TH>
            {canManage ? <TH>Acciones</TH> : null}
          </TR>
        </THead>
        <TBody>
          {members.map((m) => {
            const self = m.user_id === currentUserId;
            const storeMember = m.access === "store";
            return (
              <TR key={m.user_id}>
                <TD>
                  <span className="block font-medium">{m.full_name ?? m.email}</span>
                  {m.full_name ? (
                    <span className="text-[13px] text-fg-muted">{m.email}</span>
                  ) : null}
                </TD>
                <TD>
                  {canManage && storeMember && !self ? (
                    <Select
                      aria-label={`Rol de ${m.full_name ?? m.email}`}
                      id={`role-${m.user_id}`}
                      value={m.role_key}
                      options={
                        roles.some((r) => r.value === m.role_key)
                          ? roles
                          : [
                              {
                                value: m.role_key,
                                label: m.role_name ?? m.role_key,
                                disabled: true,
                              },
                              ...roles,
                            ]
                      }
                      onValueChange={(value) =>
                        perform(() => changeMemberRole(storeHandle, m.user_id, value))
                      }
                    />
                  ) : (
                    (ORG_ROLE[m.role_key] ?? m.role_name ?? m.role_key)
                  )}
                </TD>
                <TD>{m.status === "active" ? "Activo" : "Suspendido"}</TD>
                {canManage ? (
                  <TD>
                    <div className="flex flex-wrap gap-2">
                      {storeMember && !self ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              perform(() =>
                                setMemberStatus(
                                  storeHandle,
                                  m.user_id,
                                  m.status === "active" ? "suspended" : "active",
                                ),
                              )
                            }
                          >
                            {m.status === "active" ? "Suspender" : "Reactivar"}
                          </Button>
                          <ConfirmButton
                            label="Quitar"
                            title={`¿Quitar a ${m.full_name ?? m.email}?`}
                            description="Perderá el acceso a esta tienda de inmediato. Podrás invitarlo de nuevo."
                            confirmLabel="Quitar de la tienda"
                            onConfirm={() => perform(() => removeMember(storeHandle, m.user_id))}
                          />
                        </>
                      ) : null}
                      {canResetMfa && !self && m.role_key !== "org_owner" ? (
                        <ConfirmButton
                          label="Restablecer 2FA"
                          title="¿Restablecer la verificación en dos pasos?"
                          description="Se eliminará su app de autenticación; la configurará de nuevo en su siguiente acceso. Úsalo solo si perdió su teléfono."
                          confirmLabel="Restablecer"
                          onConfirm={() => perform(() => resetMfa(storeHandle, m.user_id))}
                        />
                      ) : null}
                    </div>
                  </TD>
                ) : null}
              </TR>
            );
          })}
        </TBody>
      </Table>

      {canManage ? (
        <Table caption="Invitaciones pendientes">
          <THead>
            <TR>
              <TH>Email</TH>
              <TH>Rol</TH>
              <TH>Caduca</TH>
              <TH>Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {invitations.length === 0 ? (
              <TR>
                <TD colSpan={4} className="text-fg-muted">
                  No hay invitaciones pendientes.
                </TD>
              </TR>
            ) : (
              invitations.map((inv) => (
                <TR key={inv.id}>
                  <TD>{inv.email}</TD>
                  <TD>{roleNames[inv.store_role_id] ?? "—"}</TD>
                  <TD>{inv.expires_label}</TD>
                  <TD>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => perform(() => revokeInvitation(storeHandle, inv.id))}
                    >
                      Revocar
                    </Button>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      ) : null}
    </div>
  );
}

function InviteDialog({ storeHandle, roles }: { storeHandle: string; roles: RoleOption[] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: TeamActionState, formData: FormData) => {
      const result = await inviteMember(storeHandle, prev, formData);
      if (result.ok) {
        setOpen(false);
        toast({ title: result.message ?? "Invitación enviada.", tone: "success" });
      }
      return result;
    },
    {},
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Invitar a alguien</Button>
      </DialogTrigger>
      <DialogContent
        title="Invitar a la tienda"
        description="Recibirá un enlace por email. Para entrar necesitará verificación en dos pasos."
      >
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.error && hasUnrenderedFieldError(state.fields, ["email", "role"]) ? (
            <p role="alert" className="text-[13px] text-danger">
              {state.error}
            </p>
          ) : null}
          <Field label="Email" required error={state.fields?.email}>
            {(control) => (
              <Input
                {...control}
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={state.values?.email ?? ""}
              />
            )}
          </Field>
          <Field label="Rol" required error={state.fields?.role}>
            {(control) => <Select {...control} name="role" options={roles} />}
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : "Enviar invitación"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="danger" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
