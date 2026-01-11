/**
 * Colored logging utility for CLI output
 */

import pc from "picocolors";

/** Log level type */
export type LogLevel = "success" | "error" | "warning" | "info" | "default";

/** Maximum length for error messages before truncation */
const MAX_ERROR_LENGTH = 1000;

/** Options for formatError */
export interface FormatErrorOptions {
  /** Include stack trace for Error objects (default: false) */
  showStack?: boolean;
}

/**
 * Truncate a string to MAX_ERROR_LENGTH with ellipsis if needed
 */
function truncateError(str: string): string {
  if (str.length <= MAX_ERROR_LENGTH) {
    return str;
  }
  return str.slice(0, MAX_ERROR_LENGTH) + "...";
}

/**
 * Safely extract error message from unknown error value
 */
export function formatError(error: unknown, options: FormatErrorOptions = {}): string {
  const { showStack = false } = options;

  if (error instanceof Error) {
    if (showStack && error.stack) {
      return truncateError(error.stack);
    }
    return truncateError(error.message);
  }

  if (typeof error === "string") {
    return truncateError(error);
  }

  try {
    return truncateError(JSON.stringify(error));
  } catch {
    return truncateError(String(error));
  }
}

/** Logger options */
export interface LoggerOptions {
  /** Include timestamp in output (default: false) */
  timestamp?: boolean;
  /** Include log level prefix (default: true) */
  prefix?: boolean;
  /** Use ASCII prefixes instead of Unicode symbols (default: false) */
  useAscii?: boolean;
}

/**
 * Format a timestamp for logging with date and timezone
 */
function formatTimestamp(): string {
  return new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

/** ASCII prefix map for older terminals */
const asciiPrefixMap: Record<LogLevel, string> = {
  success: "[OK]",
  error: "[ERR]",
  warning: "[WARN]",
  info: "[INFO]",
  default: "",
};

/** Unicode prefix map for modern terminals */
const unicodePrefixMap: Record<LogLevel, string> = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  default: "",
};

/**
 * Get the prefix for a log level
 */
function getPrefix(level: LogLevel, useAscii: boolean = false): string {
  const prefixMap = useAscii ? asciiPrefixMap : unicodePrefixMap;
  return prefixMap[level] ?? "";
}

/**
 * Apply color based on log level
 */
function colorize(message: string, level: LogLevel): string {
  switch (level) {
    case "success":
      return pc.green(message);
    case "error":
      return pc.red(message);
    case "warning":
      return pc.yellow(message);
    case "info":
      return pc.cyan(message);
    case "default":
      return message; // No colorization for default level to respect terminal theme
  }
}

/**
 * Log a message with the specified level
 */
function log(
  level: LogLevel,
  message: string,
  options: LoggerOptions = {}
): void {
  const { timestamp = false, prefix = true, useAscii = false } = options;
  const parts: string[] = [];

  // Add timestamp first (before colorization to preserve gray color)
  if (timestamp) {
    parts.push(pc.gray(`[${formatTimestamp()}]`));
  }

  // Build and colorize the main message (prefix + message)
  const mainParts: string[] = [];
  if (prefix && level !== "default") {
    mainParts.push(getPrefix(level, useAscii));
  }
  mainParts.push(message);
  const mainMessage = colorize(mainParts.join(" "), level);
  parts.push(mainMessage);

  const output = parts.join(" ");

  // Use stderr for errors and warnings, stdout for everything else
  if (level === "error" || level === "warning") {
    console.error(output);
  } else {
    console.log(output);
  }
}

/**
 * Log a success message (green)
 */
export function success(message: string, options?: LoggerOptions): void {
  log("success", message, options);
}

/**
 * Log an error message (red)
 */
export function error(message: string, options?: LoggerOptions): void {
  log("error", message, options);
}

/**
 * Log a warning message (yellow)
 */
export function warning(message: string, options?: LoggerOptions): void {
  log("warning", message, options);
}

/**
 * Log an info message (cyan)
 */
export function info(message: string, options?: LoggerOptions): void {
  log("info", message, options);
}

/**
 * Log a message with no colorization (respects terminal theme)
 */
export function plain(message: string, options?: LoggerOptions): void {
  log("default", message, options);
}

/** Logger instance type */
export type Logger = {
  success: (message: string, options?: LoggerOptions) => void;
  error: (message: string, options?: LoggerOptions) => void;
  warning: (message: string, options?: LoggerOptions) => void;
  info: (message: string, options?: LoggerOptions) => void;
  plain: (message: string, options?: LoggerOptions) => void;
};

/**
 * Create a logger instance with default options
 */
export function createLogger(defaultOptions: LoggerOptions = {}): Logger {
  return {
    success: (message: string, options?: LoggerOptions) =>
      success(message, { ...defaultOptions, ...options }),
    error: (message: string, options?: LoggerOptions) =>
      error(message, { ...defaultOptions, ...options }),
    warning: (message: string, options?: LoggerOptions) =>
      warning(message, { ...defaultOptions, ...options }),
    info: (message: string, options?: LoggerOptions) =>
      info(message, { ...defaultOptions, ...options }),
    plain: (message: string, options?: LoggerOptions) =>
      plain(message, { ...defaultOptions, ...options }),
  };
}

// Default logger instance
export const logger: Logger = {
  success,
  error,
  warning,
  info,
  plain,
};
