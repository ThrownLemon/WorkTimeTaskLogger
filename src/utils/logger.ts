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
  /** Use ASCII prefixes instead of Unicode symbols (default: false) */
  useAscii?: boolean;
}

/**
 * Format a timestamp for logging with date and timezone
 */
function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");

  // Get timezone offset in ±HH:MM format
  const offset = -now.getTimezoneOffset();
  const offsetSign = offset >= 0 ? "+" : "-";
  const offsetHours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, "0");
  const offsetMinutes = (Math.abs(offset) % 60).toString().padStart(2, "0");
  const timezone = `${offsetSign}${offsetHours}:${offsetMinutes}`;

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${timezone}`;
}

/**
 * Get the prefix for a log level
 */
function getPrefix(level: LogLevel, useAscii: boolean = false): string {
  if (useAscii) {
    switch (level) {
      case "success":
        return "[OK]";
      case "error":
        return "[ERR]";
      case "warning":
        return "[WARN]";
      case "info":
        return "[INFO]";
      case "default":
        return "";
    }
  }

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
  const { timestamp = false, prefix = true, useAscii = false } = options;
  const parts: string[] = [];

  if (timestamp) {
    parts.push(pc.gray(`[${formatTimestamp()}]`));
  }

  if (prefix && level !== "default") {
    parts.push(getPrefix(level, useAscii));
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
 * Log a default message (white)
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
export const logger = {
  success,
  error,
  warning,
  info,
  plain,
};
