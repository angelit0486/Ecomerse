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
 * El servidor ya la dibuja con su hora (`serverNow`): el primer texto es el
 * definitivo y la página no salta al cargar (antes, la regla fija ocupaba dos
 * renglones en el celular y todo bajaba 16 px, CLS 0.13–0.23). Sin `serverNow`
 * (o sin JavaScript) muestra la regla fija. Sin aria-live: un lector de
 * pantalla no la repite cada segundo.
 *
 * - «bar»: franja bajo el aviso de la tienda, en todas las páginas.
 * - «inline»: línea junto al botón de compra (ficha) y en el resumen del pago;
 *   sin región propia para no repetir la de la franja.
 */
export function DeliveryCountdown({
  config,
  variant = "bar",
  serverNow,
}: {
  config: CutoffConfig;
  variant?: "bar" | "inline";
  /** Hora del servidor al dibujar (ms): el navegador arranca igual y no hay desajuste. */
  serverNow?: number;
}) {
  const [now, setNow] = useState<Date | null>(() =>
    serverNow === undefined ? null : new Date(serverNow),
  );
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

  const text =
    state === null ? (
      <>Pide y paga antes de las {at} y llega al día siguiente hábil.</>
    ) : state.beforeCutoff ? (
      <>
        Llega {state.arrival} si pides y pagas en{" "}
        <time className="sf-cutoff-clock tabular-nums">{countdownLabel(state.msLeft)}</time>
        <span className={variant === "bar" ? "sf-cutoff-note max-sm:sr-only" : "sf-cutoff-note"}>
          {" "}
          Corte a las {at}, hora de Sonora.
        </span>
      </>
    ) : (
      <>
        Pide hoy y llega {state.arrival}.
        <span className={variant === "bar" ? "sf-cutoff-note max-sm:sr-only" : "sf-cutoff-note"}>
          {" "}
          Sin entregas sábado ni domingo.
        </span>
      </>
    );

  if (variant === "inline") {
    return (
      <p data-cutoff="inline" className="sf-cutoff-inline text-sm">
        {text}
      </p>
    );
  }
  return (
    <aside
      aria-label="Hora de corte de envío"
      className="sf-cutoff border-b border-[var(--sf-border)] px-4 py-2 text-center text-sm"
    >
      <p>{text}</p>
    </aside>
  );
}
