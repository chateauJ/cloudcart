import { Context } from "aws-lambda";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";
type Fields = Record<string, unknown>;

const LEVEL_ORDER: Record<Level, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const configuredLevel = (process.env.LOG_LEVEL ?? "INFO").toUpperCase() as Level;
const threshold = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.INFO;

// True only for the first invocation in each execution environment
let coldStart = true;

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  // Same logger with extra fields on every line, e.g. userId once auth succeeds
  child(fields: Fields): Logger;
}

export function createLogger(context: Context, fields: Fields = {}): Logger {
  const base: Fields = {
    function: context.functionName,
    requestId: context.awsRequestId,
    traceId: currentTraceId(),
    coldStart,
    ...fields,
  };
  coldStart = false;
  return buildLogger(base);
}

function buildLogger(base: Fields): Logger {
  const write = (level: Level, message: string, fields: Fields = {}) => {
    if (LEVEL_ORDER[level] < threshold) return;
    const entry = { level, message, ...base, ...serializeErrors(fields) };
    // stdout directly, not console.*: the runtime prefixes console lines with plain text,
    // which stops Logs Insights from discovering the JSON fields
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug: (message, fields) => write("DEBUG", message, fields),
    info: (message, fields) => write("INFO", message, fields),
    warn: (message, fields) => write("WARN", message, fields),
    error: (message, fields) => write("ERROR", message, fields),
    child: (fields) => buildLogger({ ...base, ...fields }),
  };
}

// Error objects stringify to {} - keep the parts that make a log line actionable
function serializeErrors(fields: Fields): Fields {
  const result: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] =
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return result;
}

// Lambda sets _X_AMZN_TRACE_ID per invocation, e.g. "Root=1-abc-def;Parent=123;Sampled=1".
// Logging the Root ID lets you jump from a log line straight to its X-Ray trace.
function currentTraceId(): string | undefined {
  return process.env._X_AMZN_TRACE_ID?.match(/Root=([^;]+)/)?.[1];
}
