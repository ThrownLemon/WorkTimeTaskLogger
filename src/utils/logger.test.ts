/**
 * Tests for logger utility
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  formatError,
  success,
  error,
  warning,
  info,
  plain,
  createLogger,
  logger,
} from "./logger.ts";

describe("formatError", () => {
  test("formats Error objects", () => {
    const err = new Error("Test error message");
    const result = formatError(err);
    expect(result).toBe("Test error message");
  });

  test("formats Error with stack when showStack is true", () => {
    const err = new Error("Test error");
    const result = formatError(err, { showStack: true });
    expect(result).toContain("Test error");
    expect(result).toContain("at"); // Stack trace contains "at"
  });

  test("formats string errors", () => {
    const result = formatError("Simple string error");
    expect(result).toBe("Simple string error");
  });

  test("formats object errors", () => {
    const result = formatError({ code: "ERR_001", message: "Object error" });
    expect(result).toContain("ERR_001");
    expect(result).toContain("Object error");
  });

  test("formats null and undefined", () => {
    expect(formatError(null)).toBe("null");
    expect(formatError(undefined)).toBe("undefined");
  });

  test("truncates long error messages", () => {
    const longMessage = "x".repeat(2000);
    const result = formatError(longMessage);
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("logger functions", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("success logs to stdout with green color", () => {
    success("Operation completed");
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("Operation completed");
    expect(output).toContain("✓");
  });

  test("error logs to stderr with red color", () => {
    error("Something failed");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const output = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("Something failed");
    expect(output).toContain("✗");
  });

  test("warning logs to stderr with yellow color", () => {
    warning("Be careful");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const output = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("Be careful");
    expect(output).toContain("⚠");
  });

  test("info logs to stdout with cyan color", () => {
    info("Status update");
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("Status update");
    expect(output).toContain("ℹ");
  });

  test("plain logs to stdout without prefix", () => {
    plain("Plain text");
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).toBe("Plain text");
  });

  test("timestamp option adds timestamp", () => {
    info("With timestamp", { timestamp: true });
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("[");
    expect(output).toContain("T"); // ISO format contains T
  });

  test("prefix option can disable prefix", () => {
    success("No prefix", { prefix: false });
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain("✓");
  });

  test("useAscii option uses ASCII prefixes", () => {
    success("ASCII mode", { useAscii: true });
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("[OK]");
    expect(output).not.toContain("✓");
  });
});

describe("createLogger", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test("creates logger with default options", () => {
    const customLogger = createLogger({ useAscii: true });
    customLogger.success("Test");

    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("[OK]");
  });

  test("options can be overridden per call", () => {
    const customLogger = createLogger({ useAscii: true });
    customLogger.success("Test", { useAscii: false });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("✓");
  });
});

describe("logger instance", () => {
  test("logger has all methods", () => {
    expect(typeof logger.success).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warning).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.plain).toBe("function");
  });
});
