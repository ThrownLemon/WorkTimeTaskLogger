/**
 * Colored logging utility for CLI output
 */

import pc from "picocolors";

/** Log level type */
export type LogLevel = "success" | "error" | "warning" | "info" | "default";

/**
 * Safely extract error message from unknown error value
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Logger options */
export interface LoggerOptions {
  /** Include timestamp in output (default: false) */
  timestamp?: boolean;
  /** Include log level prefix (default: true) */
  prefix?: boolean;
}

/**
 * Format a timestamp for logging
 */
function formatTimestamp(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Get the prefix for a log level
 */
function getPrefix(level: LogLevel): string {
  switch (level) {
    case "success":
      return "✓";
    case "error":
      return "✗";
    case "warning":
      return "⚠";
    case "info":
      return "ℹ";
    case "default":
      return "";
  }
}

/**
 * Format a log message with optional timestamp and prefix
 */
function formatMessage(
  message: string,
  level: LogLevel,
  options: LoggerOptions = {}
): string {
  const { timestamp = false, prefix = true } = options;
  const parts: string[] = [];

  if (timestamp) {
    parts.push(pc.gray(`[${formatTimestamp()}]`));
  }

  if (prefix && level !== "default") {
    parts.push(getPrefix(level));
  }

  parts.push(message);

  return parts.join(" ");
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
      return pc.white(message);
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
  const formatted = formatMessage(message, level, options);
  const colored = colorize(formatted, level);

  // Use stderr for errors and warnings, stdout for everything else
  if (level === "error" || level === "warning") {
    console.error(colored);
  } else {
    console.log(colored);
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
 * Log a default message (white)
 */
export function plain(message: string, options?: LoggerOptions): void {
  log("default", message, options);
}

/**
 * Create a logger instance with default options
 */
export function createLogger(defaultOptions: LoggerOptions = {}): {
  success: (message: string, options?: LoggerOptions) => void;
  error: (message: string, options?: LoggerOptions) => void;
  warning: (message: string, options?: LoggerOptions) => void;
  info: (message: string, options?: LoggerOptions) => void;
  plain: (message: string, options?: LoggerOptions) => void;
} {
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
export const logger = {
  success,
  error,
  warning,
  info,
  plain,
};
