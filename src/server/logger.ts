type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitiveKey = /(password|passwd|token|secret|authorization|cookie|database[_-]?url|credential)/i;

function configuredLevel(): LogLevel {
  const level = process.env.LOG_LEVEL;
  return level === "debug" || level === "warn" || level === "error" ? level : "info";
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi, "$1[REDACTED]@")
    .replace(/((?:password|passwd|token|secret|auth[_-]?secret|database[_-]?url)=)[^&\s]+/gi, "$1[REDACTED]");
}

function sanitize(value: unknown, key: string | null, seen: WeakSet<object>, depth: number): unknown {
  if (key && sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (depth >= 6) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item, null, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = sanitize(childValue, childKey, seen, depth + 1);
  }
  return output;
}

function sanitizeFields(fields: LogFields): LogFields {
  return sanitize(fields, null, new WeakSet<object>(), 0) as LogFields;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}) {
  if (rank[level] < rank[configuredLevel()]) return;
  const sanitizedFields = sanitizeFields(fields);
  const event = JSON.stringify({
    ...sanitizedFields,
    timestamp: new Date().toISOString(),
    level,
    message: redactString(message),
    service: "kpi-performance-studio",
  });

  if (level === "error") console.error(event);
  else if (level === "warn") console.warn(event);
  else console.log(event);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};
