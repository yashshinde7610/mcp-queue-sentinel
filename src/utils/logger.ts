type LogLevel = "info" | "warn" | "error" | "debug";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatEntry(level: LogLevel, component: string, message: string, meta?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    component,
    msg: message,
  };
  if (meta) Object.assign(entry, meta);
  return JSON.stringify(entry);
}

export const logger = {
  info(component: string, message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("info")) {
      process.stderr.write(formatEntry("info", component, message, meta) + "\n");
    }
  },

  warn(component: string, message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("warn")) {
      process.stderr.write(formatEntry("warn", component, message, meta) + "\n");
    }
  },

  error(component: string, message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("error")) {
      process.stderr.write(formatEntry("error", component, message, meta) + "\n");
    }
  },

  debug(component: string, message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("debug")) {
      process.stderr.write(formatEntry("debug", component, message, meta) + "\n");
    }
  },
};
