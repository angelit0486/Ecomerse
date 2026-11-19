/**
 * Hora de corte de envío (Nocturno, Alien Demon, 2026-11-19): «pide y paga antes
 * de las 4:20 pm y llega al día siguiente». La paquetería no trabaja sábado ni
 * domingo: lo que sale en viernes llega el lunes y lo pedido en fin de semana sale
 * el lunes. Función pura (el reloj y la zona entran como datos) para probarla.
 */
export interface CutoffConfig {
  /** Hora y minuto locales del corte (24 h). */
  hour: number;
  minute: number;
  /** Zona IANA donde se cuenta la hora (p. ej. America/Hermosillo). */
  timeZone: string;
  /** Días hábiles de la paquetería, 0 = domingo … 6 = sábado. */
  businessDays: readonly number[];
}

export interface CutoffState {
  /** true si todavía se alcanza el envío de hoy. */
  beforeCutoff: boolean;
  /** Milisegundos hasta el corte de hoy (0 si ya pasó o hoy no hay envíos). */
  msLeft: number;
  /** «mañana» o «el lunes»: cuándo llega si se pide ahora. */
  arrival: string;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Fecha y hora locales de `now` en la zona dada. */
function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Día de la semana de una fecha de calendario (sin zona). */
function weekday(dayIndex: number): number {
  // dayIndex = días desde 1970-01-01 (jueves).
  return (((dayIndex + 4) % 7) + 7) % 7;
}

export function deliveryCutoff(now: Date, config: CutoffConfig): CutoffState {
  const p = localParts(now, config.timeZone);
  const today = Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 864e5);
  const isBusiness = (d: number) => config.businessDays.includes(weekday(d));
  const nextBusiness = (d: number) => {
    let n = d + 1;
    while (!isBusiness(n)) n += 1;
    return n;
  };

  const secondsNow = p.hour * 3600 + p.minute * 60 + p.second;
  const secondsCutoff = config.hour * 3600 + config.minute * 60;
  const beforeCutoff = isBusiness(today) && secondsNow < secondsCutoff;
  const shipDay = beforeCutoff ? today : nextBusiness(today);
  const arrivalDay = nextBusiness(shipDay);

  return {
    beforeCutoff,
    msLeft: beforeCutoff ? (secondsCutoff - secondsNow) * 1000 : 0,
    arrival: arrivalDay === today + 1 ? "mañana" : `el ${WEEKDAYS.at(weekday(arrivalDay))}`,
  };
}

/** «2:05:09» o «45:09»: lo que falta para el corte. */
export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Corte de Alien Demon: 4:20 pm hora de Hermosillo, lunes a viernes. */
export const ALIEN_DEMON_CUTOFF: CutoffConfig = {
  hour: 16,
  minute: 20,
  timeZone: "America/Hermosillo",
  businessDays: [1, 2, 3, 4, 5],
};
