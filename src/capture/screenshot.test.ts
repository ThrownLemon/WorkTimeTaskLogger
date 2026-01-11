/**
 * Tests for screenshot utilities
 */

import { describe, test, expect } from "bun:test";
import { formatBytes, getScreenshotPath, screenshotExists } from "./screenshot.ts";
import type { TrackerConfig } from "../types.ts";

// Helper to create a mock TrackerConfig
function createConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    captureIntervalMinutes: 5,
    idleThresholdSeconds: 300,
    screenshotDir: "/tmp/test-screenshots",
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

describe("formatBytes", () => {
  test("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 Bytes");
  });

  test("formats bytes", () => {
    expect(formatBytes(1)).toBe("1 Bytes");
    expect(formatBytes(500)).toBe("500 Bytes");
    expect(formatBytes(1023)).toBe("1023 Bytes");
  });

  test("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10240)).toBe("10 KB");
    expect(formatBytes(1048575)).toBe("1024 KB");
  });

  test("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
    expect(formatBytes(10485760)).toBe("10 MB");
    expect(formatBytes(104857600)).toBe("100 MB");
  });

  test("formats gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1 GB");
    expect(formatBytes(1610612736)).toBe("1.5 GB");
    expect(formatBytes(10737418240)).toBe("10 GB");
  });

  test("rounds to 2 decimal places", () => {
    expect(formatBytes(1500)).toBe("1.46 KB");
    expect(formatBytes(1536000)).toBe("1.46 MB");
  });
});

describe("getScreenshotPath", () => {
  test("generates path with correct directory", () => {
    const config = createConfig({ screenshotDir: "/data/screenshots" });
    const timestamp = new Date("2025-01-15T14:30:45.123Z");

    const path = getScreenshotPath(config, timestamp);
    expect(path).toContain("/data/screenshots/");
  });

  test("generates filename with timestamp", () => {
    const config = createConfig();
    const timestamp = new Date("2025-01-15T14:30:45.123Z");

    const path = getScreenshotPath(config, timestamp);
    expect(path).toContain("screenshot-");
    expect(path).toContain("2025-01-15");
    expect(path).toContain(".jpg");
  });

  test("generates unique paths for different timestamps", () => {
    const config = createConfig();
    const timestamp1 = new Date("2025-01-15T14:30:45.000Z");
    const timestamp2 = new Date("2025-01-15T14:30:46.000Z");

    const path1 = getScreenshotPath(config, timestamp1);
    const path2 = getScreenshotPath(config, timestamp2);

    expect(path1).not.toBe(path2);
  });

  test("uses .jpg extension", () => {
    const config = createConfig();
    const timestamp = new Date();

    const path = getScreenshotPath(config, timestamp);
    expect(path.endsWith(".jpg")).toBe(true);
  });
});

describe("screenshotExists", () => {
  test("returns false for non-existent file", async () => {
    const exists = await screenshotExists("/nonexistent/path/screenshot.jpg");
    expect(exists).toBe(false);
  });

  test("returns false for invalid path", async () => {
    const exists = await screenshotExists("");
    expect(exists).toBe(false);
  });
});

describe("screenshot filename format", () => {
  // Test the expected filename format

  test("filename contains ISO-like timestamp", () => {
    const config = createConfig();
    const timestamp = new Date("2025-01-15T14:30:45.123Z");

    const path = getScreenshotPath(config, timestamp);
    const filename = path.split("/").pop();

    expect(filename).toMatch(/^screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
  });

  test("filename replaces colons and dots with dashes", () => {
    const config = createConfig();
    const timestamp = new Date("2025-01-15T14:30:45.123Z");

    const path = getScreenshotPath(config, timestamp);

    // Colons are replaced with dashes for filesystem compatibility
    expect(path).not.toContain(":");
  });
});

describe("blur settings", () => {
  // Test configuration for blur

  test("config can have blur disabled", () => {
    const config = createConfig({ blurScreenshots: false, blurIntensity: 0 });
    expect(config.blurScreenshots).toBe(false);
    expect(config.blurIntensity).toBe(0);
  });

  test("config can have blur enabled with intensity", () => {
    const config = createConfig({ blurScreenshots: true, blurIntensity: 50 });
    expect(config.blurScreenshots).toBe(true);
    expect(config.blurIntensity).toBe(50);
  });

  test("blur intensity can be at boundaries", () => {
    const configMin = createConfig({ blurIntensity: 0 });
    const configMax = createConfig({ blurIntensity: 100 });

    expect(configMin.blurIntensity).toBe(0);
    expect(configMax.blurIntensity).toBe(100);
  });
});
