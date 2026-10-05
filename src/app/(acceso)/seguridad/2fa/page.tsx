import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { startTotpEnrollment, verifyTotp } from "../../actions";
import { CodeForm, TotpEnrollment } from "../../forms";

export const metadata: Metadata = { title: "Verificación en dos pasos" };

/**
 * Todo el staff necesita TOTP (Q-B2). Con un factor verificado se pide el código;
 * si no, se guía el enrolamiento.
 */
export default async function TwoFactorPage() {
  const session = await getSession();
  if (!session) redirect("/ingresar");
  if (session.aal === "aal2") redirect("/admin");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = data?.totp.find((f) => f.status === "verified");

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Verificación en dos pasos</h1>
        <p className="text-sm text-fg-muted">
          {verified
            ? "Escribe el código de 6 dígitos de tu app de autenticación."
            : "Para proteger las tiendas, todo el equipo usa una app de autenticación."}
        </p>
      </header>
      {verified ? (
        <CodeForm action={verifyTotp} label="Código de la app" hidden={{ factorId: verified.id }} />
      ) : (
        <TotpEnrollment start={startTotpEnrollment} verify={verifyTotp} />
      )}
    </>
  );
}
