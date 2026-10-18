import type { Metadata } from "next";
import Link from "next/link";

import { requireStaffSession } from "@/server/auth/guards";

import { setPassword } from "../../actions";
import { SetPasswordForm } from "../../forms";

export const metadata: Metadata = { title: "Contraseña" };

/** ADR-031: solo con la sesión completa (email o contraseña + app de autenticación). */
export default async function SetPasswordPage() {
  await requireStaffSession();
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Contraseña del panel</h1>
        <p className="text-sm text-fg-muted">
          Con ella entras aunque no te llegue el código por email. El código de tu app de
          autenticación se sigue pidiendo siempre.
        </p>
      </header>
      <SetPasswordForm action={setPassword} />
      <Link href="/admin" className="text-sm underline">
        Volver al panel
      </Link>
    </>
  );
}
