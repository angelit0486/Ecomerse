import { redact, redactString } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Logger con campos fijos (request_id, store_id, módulo…). */
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  base?: LogFields;
  sink?: (line: string) => void;
  now?: () => Date;
}

/**
 * Logger JSON estructurado (una línea por evento). Todo campo y mensaje pasa por
 * la redacción antes de escribirse (GATE0 §35).
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const write = (lineLevel: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_ORDER[lineLevel] < LEVEL_ORDER[level]) return;
    const record = {
      ts: now().toISOString(),
      level: lineLevel,
      msg: redactString(message),
      ...(redact(base) as LogFields),
      ...(fields ? (redact(fields) as LogFields) : {}),
    };
    sink(JSON.stringify(record));
  };

  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...options, level, base: { ...base, ...fields } }),
  };
}

function levelFromEnv(value: string | undefined): LogLevel {
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

/** Logger de proceso. */
export const log: Logger = createLogger({ level: levelFromEnv(process.env.LOG_LEVEL) });
