export type LogLevel = "debug" | "info" | "warn" | "error";

export interface WritableStream {
  write(chunk: string): unknown;
}

export interface LoggingOptions {
  stream?: WritableStream;
  now?: () => Date;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface LoggingConfig {
  level: LogLevel;
  stream: WritableStream;
  now: () => Date;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let config: LoggingConfig | undefined;
let explicitlyConfigured = false;

function defaultConfig(): LoggingConfig {
  return {
    level: "info",
    stream: process.stderr,
    now: () => new Date(),
  };
}

export function setupLogging(level: LogLevel = "info", options: LoggingOptions = {}): void {
  if (explicitlyConfigured) {
    return;
  }
  config = {
    level,
    stream: options.stream ?? process.stderr,
    now: options.now ?? (() => new Date()),
  };
  explicitlyConfigured = true;
}

function emit(name: string, level: LogLevel, message: string): void {
  config ??= defaultConfig();
  const activeConfig = config;
  if (!activeConfig || LEVEL_RANK[level] < LEVEL_RANK[activeConfig.level]) {
    return;
  }
  activeConfig.stream.write(
    `${activeConfig.now().toISOString()} ${level.toUpperCase()} ${name}: ${message}\n`,
  );
}

export function getLogger(name: string): Logger {
  return {
    debug: (message) => emit(name, "debug", message),
    info: (message) => emit(name, "info", message),
    warn: (message) => emit(name, "warn", message),
    error: (message) => emit(name, "error", message),
  };
}
