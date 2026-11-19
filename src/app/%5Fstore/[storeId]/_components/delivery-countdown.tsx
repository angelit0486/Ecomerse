"use client";

import { useEffect, useState } from "react";

import { countdownLabel, deliveryCutoff, type CutoffConfig } from "@/lib/theme/delivery-cutoff";

/** «4:20 pm» a partir de la hora de corte. */
function cutoffTime(config: CutoffConfig): string {
  const h = config.hour % 12 === 0 ? 12 : config.hour % 12;
  return `${h}:${String(config.minute).padStart(2, "0")} ${config.hour < 12 ? "am" : "pm"}`;
}

/**
 * Cuenta regresiva a la hora de corte de envío (solo con un look que la define).
 * En el servidor y sin JavaScript muestra la regla fija; en el navegador, cuánto
 * falta y cuándo llega. Sin aria-live: un lector de pantalla no la repite cada
 * segundo.
 */
export function DeliveryCountdown({ config }: { config: CutoffConfig }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Primer valor fuera del cuerpo del efecto (regla react-hooks) y luego cada segundo.
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const at = cutoffTime(config);
  const state = now ? deliveryCutoff(now, config) : null;

  return (
    <aside
      aria-label="Hora de corte de envío"
      className="sf-cutoff border-b border-[var(--sf-border)] px-4 py-2 text-center text-sm"
    >
      {state === null ? (
        <p>Pide y paga antes de las {at} y llega al día siguiente hábil.</p>
      ) : state.beforeCutoff ? (
        <p>
          Llega {state.arrival} si pides y pagas en{" "}
          <time className="sf-cutoff-clock tabular-nums">{countdownLabel(state.msLeft)}</time>
          <span className="sf-cutoff-note max-sm:sr-only"> Corte a las {at}, hora de Sonora.</span>
        </p>
      ) : (
        <p>
          Pide hoy y llega {state.arrival}.
          <span className="sf-cutoff-note max-sm:sr-only"> Sin entregas sábado ni domingo.</span>
        </p>
      )}
    </aside>
  );
}
