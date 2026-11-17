/**
 * Plan y uso: textos honestos cuando algo no se pudo leer y opciones de pago
 * que no desaparecen en silencio. `loadPlanUsage` no cambia (el layout depende
 * de que no lance); aquí solo se decide qué decirle a la dueña.
 */

export const PLAN_UNAVAILABLE_TEXT =
  "No pudimos cargar tu plan en este momento. Recarga la página; si sigue pasando, avisa a soporte.";

export const PAYMENT_OPTIONS_ERROR_TEXT =
  "No pudimos cargar las opciones de pago. Recarga la página para intentarlo de nuevo.";

/** Pagar o cambiar el plan con tarjeta: solo la dueña y con Stripe configurado (ADR-044). */
export function canPayOnline(orgRole: string | null | undefined, stripeConfigured: boolean) {
  return orgRole === "org_owner" && stripeConfigured;
}

export interface PaymentOptions<Plan, Change> {
  plans: Plan[];
  change: Change | null;
  /** Alguna lectura falló: se avisa en lugar de ocultar la sección. */
  failed: boolean;
}

/**
 * Planes a pagar y opciones de cambio. Sin permiso no se consulta nada (y no hay
 * aviso); si una lectura falla, `failed` y esa parte queda vacía.
 */
export async function loadPaymentOptions<Plan, Change>(
  allowed: boolean,
  loadPlans: () => Promise<Plan[]>,
  loadChange: () => Promise<Change | null>,
  onError: (error: unknown) => void = () => {},
): Promise<PaymentOptions<Plan, Change>> {
  if (!allowed) return { plans: [], change: null, failed: false };
  let failed = false;
  const settle = async <T>(load: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await load();
    } catch (error) {
      failed = true;
      onError(error);
      return fallback;
    }
  };
  const [plans, change] = await Promise.all([
    settle(loadPlans, [] as Plan[]),
    settle<Change | null>(loadChange, null),
  ]);
  return { plans, change, failed };
}
