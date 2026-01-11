/**
 * Tests for idle detection utilities
 */

import { describe, test, expect } from "bun:test";
import { formatIdleTime, createIdleWatcher } from "./idle.ts";
import type { TrackerConfig } from "../types.ts";

// Helper to create a mock TrackerConfig
function createConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    captureIntervalMinutes: 5,
    idleThresholdSeconds: 300,
    screenshotDir: "/tmp/screenshots",
    databasePath: "/tmp/test.db",
    blurScreenshots: false,
    blurIntensity: 20,
    excludedApps: [],
    projects: [],
    isRunning: false,
    llmProvider: "proxy",
    llmProxyUrl: null,
    llmVisionModel: "test-model",
    llmTextModel: "test-model",
    ...overrides,
  };
}

describe("formatIdleTime", () => {
  test("formats seconds under a minute", () => {
    expect(formatIdleTime(0)).toBe("0s");
    expect(formatIdleTime(1)).toBe("1s");
    expect(formatIdleTime(30)).toBe("30s");
    expect(formatIdleTime(59)).toBe("59s");
  });

  test("formats minutes", () => {
    expect(formatIdleTime(60)).toBe("1m 0s");
    expect(formatIdleTime(90)).toBe("1m 30s");
    expect(formatIdleTime(120)).toBe("2m 0s");
    expect(formatIdleTime(300)).toBe("5m 0s");
    expect(formatIdleTime(3599)).toBe("59m 59s");
  });

  test("formats hours", () => {
    expect(formatIdleTime(3600)).toBe("1h 0m");
    expect(formatIdleTime(3660)).toBe("1h 1m");
    expect(formatIdleTime(7200)).toBe("2h 0m");
    expect(formatIdleTime(7320)).toBe("2h 2m");
    expect(formatIdleTime(36000)).toBe("10h 0m");
  });

  test("handles edge cases", () => {
    expect(formatIdleTime(61)).toBe("1m 1s");
    expect(formatIdleTime(3601)).toBe("1h 0m");
    expect(formatIdleTime(3661)).toBe("1h 1m");
  });
});

describe("createIdleWatcher", () => {
  test("returns object with start and stop methods", () => {
    const config = createConfig({ idleThresholdSeconds: 300 });
    const watcher = createIdleWatcher(config, () => {});

    expect(typeof watcher.start).toBe("function");
    expect(typeof watcher.stop).toBe("function");
  });

  test("stop can be called without start", () => {
    const config = createConfig({ idleThresholdSeconds: 300 });
    const watcher = createIdleWatcher(config, () => {});

    // Should not throw
    expect(() => watcher.stop()).not.toThrow();
  });

  test("start and stop can be called multiple times", () => {
    const config = createConfig({ idleThresholdSeconds: 300 });
    const watcher = createIdleWatcher(config, () => {});

    // Should not throw when called multiple times
    expect(() => {
      watcher.start();
      watcher.start(); // Called again
      watcher.stop();
      watcher.stop(); // Called again
    }).not.toThrow();
  });
});
