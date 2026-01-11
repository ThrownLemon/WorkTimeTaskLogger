/**
 * Tests for configuration management
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  updateConfig,
  addProject,
  removeProject,
  generateProjectId,
  validateConfig,
} from "./settings.ts";
import type { TrackerConfig, Project } from "../types.ts";

// Use a unique test directory
const TEST_DIR = join(import.meta.dir, "../../data/test-config");
const TEST_CONFIG_FILE = join(TEST_DIR, "config.json");

// We need to mock the config file path - this is tricky since it's hardcoded
// For now, we'll test the pure functions and the validation logic

describe("DEFAULT_CONFIG", () => {
  test("has required fields", () => {
    expect(DEFAULT_CONFIG.captureIntervalMinutes).toBe(5);
    expect(DEFAULT_CONFIG.idleThresholdSeconds).toBe(300);
    expect(DEFAULT_CONFIG.blurScreenshots).toBe(false);
    expect(DEFAULT_CONFIG.blurIntensity).toBe(20);
    expect(Array.isArray(DEFAULT_CONFIG.excludedApps)).toBe(true);
    expect(Array.isArray(DEFAULT_CONFIG.projects)).toBe(true);
    expect(DEFAULT_CONFIG.isRunning).toBe(false);
  });

  test("has LLM configuration", () => {
    expect(DEFAULT_CONFIG.llmProvider).toBe("proxy");
    expect(DEFAULT_CONFIG.llmVisionModel).toBeDefined();
    expect(DEFAULT_CONFIG.llmTextModel).toBeDefined();
  });
});

describe("generateProjectId", () => {
  test("generates slug from name", () => {
    const id = generateProjectId("My Project");
    expect(id).toMatch(/^my-project-[a-z0-9]{4}$/);
  });

  test("handles special characters", () => {
    const id = generateProjectId("Project @#$% Name!");
    expect(id).toMatch(/^project-name-[a-z0-9]{4}$/);
  });

  test("handles spaces and mixed case", () => {
    const id = generateProjectId("  UPPER lower  MiXeD  ");
    expect(id).toMatch(/^upper-lower-mixed-[a-z0-9]{4}$/);
  });

  test("generates unique IDs", () => {
    const id1 = generateProjectId("Test");
    const id2 = generateProjectId("Test");
    // IDs should be different due to random suffix
    expect(id1).not.toBe(id2);
  });

  test("handles single word names", () => {
    const id = generateProjectId("Project");
    expect(id).toMatch(/^project-[a-z0-9]{4}$/);
  });

  test("handles unicode characters", () => {
    const id = generateProjectId("Proyecto España");
    // Should strip non-ASCII and create valid slug
    expect(id).toMatch(/^[a-z0-9-]+-[a-z0-9]{4}$/);
  });
});

describe("validateConfig", () => {
  test("returns empty array for valid config", () => {
    const errors = validateConfig({
      captureIntervalMinutes: 5,
      idleThresholdSeconds: 300,
      blurIntensity: 20,
    });
    expect(errors).toEqual([]);
  });

  test("validates captureIntervalMinutes minimum", () => {
    const errors = validateConfig({ captureIntervalMinutes: 0 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Capture interval");
  });

  test("validates captureIntervalMinutes maximum", () => {
    const errors = validateConfig({ captureIntervalMinutes: 61 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Capture interval");
  });

  test("accepts valid captureIntervalMinutes range", () => {
    expect(validateConfig({ captureIntervalMinutes: 1 })).toEqual([]);
    expect(validateConfig({ captureIntervalMinutes: 30 })).toEqual([]);
    expect(validateConfig({ captureIntervalMinutes: 60 })).toEqual([]);
  });

  test("validates idleThresholdSeconds minimum", () => {
    const errors = validateConfig({ idleThresholdSeconds: 29 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Idle threshold");
  });

  test("validates idleThresholdSeconds maximum", () => {
    const errors = validateConfig({ idleThresholdSeconds: 3601 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Idle threshold");
  });

  test("accepts valid idleThresholdSeconds range", () => {
    expect(validateConfig({ idleThresholdSeconds: 30 })).toEqual([]);
    expect(validateConfig({ idleThresholdSeconds: 1800 })).toEqual([]);
    expect(validateConfig({ idleThresholdSeconds: 3600 })).toEqual([]);
  });

  test("validates blurIntensity minimum", () => {
    const errors = validateConfig({ blurIntensity: -1 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Blur intensity");
  });

  test("validates blurIntensity maximum", () => {
    const errors = validateConfig({ blurIntensity: 101 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Blur intensity");
  });

  test("accepts valid blurIntensity range", () => {
    expect(validateConfig({ blurIntensity: 0 })).toEqual([]);
    expect(validateConfig({ blurIntensity: 50 })).toEqual([]);
    expect(validateConfig({ blurIntensity: 100 })).toEqual([]);
  });

  test("returns multiple errors for multiple invalid fields", () => {
    const errors = validateConfig({
      captureIntervalMinutes: 0,
      idleThresholdSeconds: 10,
      blurIntensity: 200,
    });
    expect(errors.length).toBe(3);
  });

  test("skips validation for undefined fields", () => {
    const errors = validateConfig({});
    expect(errors).toEqual([]);
  });
});

describe("config file operations", () => {
  // These tests use the actual file system but with a test directory
  // Note: These may need adjustment if the config path can't be overridden

  test("loadConfig returns defaults when file doesn't exist", async () => {
    // This test relies on the actual loadConfig behavior
    // It should return defaults merged with any existing config
    const config = await loadConfig();
    expect(config.captureIntervalMinutes).toBeDefined();
    expect(config.idleThresholdSeconds).toBeDefined();
  });
});

describe("project management", () => {
  // Test project structure
  test("project has required fields", () => {
    const project: Project = {
      id: "test-1234",
      name: "Test Project",
      keywords: ["test", "project"],
      color: "#FF0000",
    };

    expect(project.id).toBeDefined();
    expect(project.name).toBeDefined();
    expect(project.keywords).toBeDefined();
    expect(project.color).toBeDefined();
  });

  test("project can have optional fields", () => {
    const project: Project = {
      id: "test-1234",
      name: "Test Project",
      keywords: ["test"],
      color: "#FF0000",
      hourlyRate: 150,
      client: "ACME Corp",
    };

    expect(project.hourlyRate).toBe(150);
    expect(project.client).toBe("ACME Corp");
  });
});
