import type { Metadata } from "next";

import { getSession } from "@/server/auth/session";
import { maskEmail, peekInvitation } from "@/server/invitations/peek";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/primitives/empty-state";

import { acceptInvitation, continueInvitation, startInvitationLogin } from "../../actions";
import { ActionButton } from "../../forms";

export const metadata: Metadata = { title: "Invitación" };

type Props = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: Props) {
  const { token } = await params;
  const invitation = await peekInvitation(token);
  if (!invitation) {
    return (
      <EmptyState
        title="Invitación no válida"
        description="El enlace caducó, ya se usó o fue revocado. Pide a quien te invitó que te envíe uno nuevo."
      />
    );
  }

  const destination = invitation.storeName
    ? `${invitation.storeName} (${invitation.organizationName})`
    : invitation.organizationName;
  const session = await getSession();

  let body;
  if (!session) {
    body = (
      <>
        <p className="text-sm text-fg-muted">
          Te enviaremos un código a <strong>{maskEmail(invitation.email)}</strong>. Después
          activarás la verificación en dos pasos.
        </p>
        <ActionButton action={startInvitationLogin.bind(null, token)} label="Enviarme un código" />
      </>
    );
  } else if (session.email?.toLowerCase() !== invitation.email) {
    body = (
      <>
        <p role="alert" className="text-sm text-danger">
          Esta invitación es para {maskEmail(invitation.email)}. Sal y entra con esa cuenta.
        </p>
        <form action="/salir" method="post">
          <Button type="submit" variant="secondary">
            Salir
          </Button>
        </form>
      </>
    );
  } else if (session.aal !== "aal2") {
    body = (
      <form action={continueInvitation.bind(null, token)}>
        <Button type="submit">Continuar con la verificación en dos pasos</Button>
      </form>
    );
  } else {
    body = <ActionButton action={acceptInvitation.bind(null, token)} label="Aceptar invitación" />;
  }

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Te invitaron a {destination}</h1>
      </header>
      {body}
    </>
  );
}
