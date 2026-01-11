/**
 * Tests for export functionality
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import {
  generateExportFilename,
  escapeCSV,
  exportTimeEntries,
  exportWeeklyReport,
  exportForTimesheetSystem,
} from "./export.ts";
import {
  initDatabase,
  closeDatabase,
  insertTimeEntry,
} from "../storage/database.ts";

// Use unique DB path per test to avoid conflicts
let testDbPath: string;
let testId = 0;

function getUniqueDbPath(): string {
  return join(import.meta.dir, `../../data/test-export-${Date.now()}-${++testId}.db`);
}

function cleanupDb(dbPath: string): void {
  const filesToClean = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of filesToClean) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe("generateExportFilename", () => {
  test("generates CSV filename for entries", () => {
    const startDate = new Date("2025-01-13");
    const endDate = new Date("2025-01-19");

    const filename = generateExportFilename(startDate, endDate, "csv", "entries");
    expect(filename).toBe("timesheet-entries-2025-01-13-to-2025-01-19.csv");
  });

  test("generates JSON filename for entries", () => {
    const startDate = new Date("2025-01-13");
    const endDate = new Date("2025-01-19");

    const filename = generateExportFilename(startDate, endDate, "json", "entries");
    expect(filename).toBe("timesheet-entries-2025-01-13-to-2025-01-19.json");
  });

  test("generates filename for report", () => {
    const startDate = new Date("2025-01-13");
    const endDate = new Date("2025-01-19");

    const filename = generateExportFilename(startDate, endDate, "csv", "report");
    expect(filename).toBe("timesheet-report-2025-01-13-to-2025-01-19.csv");
  });

  test("defaults to entries type", () => {
    const startDate = new Date("2025-01-13");
    const endDate = new Date("2025-01-19");

    const filename = generateExportFilename(startDate, endDate, "csv");
    expect(filename).toContain("entries");
  });

  test("handles different date ranges", () => {
    const filename = generateExportFilename(
      new Date("2024-12-01"),
      new Date("2024-12-31"),
      "json",
      "report"
    );
    expect(filename).toBe("timesheet-report-2024-12-01-to-2024-12-31.json");
  });

  test("uses ISO date format (YYYY-MM-DD)", () => {
    const startDate = new Date("2025-06-05"); // Single digit month/day
    const endDate = new Date("2025-06-09");

    const filename = generateExportFilename(startDate, endDate, "csv");
    expect(filename).toMatch(/2025-06-05/);
    expect(filename).toMatch(/2025-06-09/);
  });
});

describe("escapeCSV", () => {
  test("escapes values with commas", () => {
    expect(escapeCSV("Hello, World")).toBe('"Hello, World"');
  });

  test("escapes values with quotes by doubling them", () => {
    expect(escapeCSV('Say "Hello"')).toBe('"Say ""Hello"""');
  });

  test("escapes values with newlines", () => {
    expect(escapeCSV("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
  });

  test("leaves safe values unchanged", () => {
    expect(escapeCSV("SimpleText123")).toBe("SimpleText123");
  });

  test("handles empty strings", () => {
    expect(escapeCSV("")).toBe("");
  });

  test("handles values with multiple special characters", () => {
    expect(escapeCSV('Hello, "World"\nNew line')).toBe('"Hello, ""World""\nNew line"');
  });

  test("handles values with only quotes", () => {
    expect(escapeCSV('"')).toBe('""""');
  });
});

describe("exportTimeEntries", () => {
  beforeEach(() => {
    testDbPath = getUniqueDbPath();
    initDatabase(testDbPath);
  });

  afterEach(() => {
    closeDatabase();
    cleanupDb(testDbPath);
  });

  test("exports entries to CSV format with correct headers", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "test.ts - project",
      screenshotPath: null,
      taskDescription: "Writing tests",
      projectId: "test-proj",
      manualProjectId: null,
      durationSeconds: 3600,
      isIdle: false,
      aiAnalysis: null,
    });

    const csv = await exportTimeEntries({
      format: "csv",
      startDate: new Date(today.getTime() - 86400000),
      endDate: new Date(today.getTime() + 86400000),
    });

    const headerLine = csv.split("\n")[0];
    expect(headerLine).toContain("ID");
    expect(headerLine).toContain("Timestamp");
    expect(headerLine).toContain("Application");
    expect(headerLine).toContain("Window Title");
    expect(headerLine).toContain("Task Description");
    expect(headerLine).toContain("Project ID");
    expect(headerLine).toContain("Duration");
  });

  test("exports entries to JSON format with correct structure", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "test.ts",
      screenshotPath: null,
      taskDescription: "Coding",
      projectId: null,
      manualProjectId: null,
      durationSeconds: 1800,
      isIdle: false,
      aiAnalysis: null,
    });

    const json = await exportTimeEntries({
      format: "json",
      startDate: new Date(today.getTime() - 86400000),
      endDate: new Date(today.getTime() + 86400000),
    });

    const data = JSON.parse(json);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    const entry = data[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("timestamp");
    expect(entry).toHaveProperty("appName");
    expect(entry).toHaveProperty("windowTitle");
    expect(entry).toHaveProperty("taskDescription");
    expect(entry).toHaveProperty("durationSeconds");
    expect(entry).toHaveProperty("isIdle");
  });

  test("handles empty date range", async () => {
    const farFuture = new Date("2099-01-01");
    const farFuture2 = new Date("2099-01-02");

    const csv = await exportTimeEntries({
      format: "csv",
      startDate: farFuture,
      endDate: farFuture2,
    });

    const lines = csv.split("\n");
    expect(lines.length).toBe(1); // Only headers
  });
});

describe("exportForTimesheetSystem", () => {
  beforeEach(() => {
    testDbPath = getUniqueDbPath();
    initDatabase(testDbPath);
  });

  afterEach(() => {
    closeDatabase();
    cleanupDb(testDbPath);
  });

  test("Harvest format has correct headers", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "test.ts",
      screenshotPath: null,
      taskDescription: "Coding",
      projectId: "test-proj",
      manualProjectId: null,
      durationSeconds: 3600,
      isIdle: false,
      aiAnalysis: null,
    });

    const csv = await exportForTimesheetSystem(
      new Date(today.getTime() - 86400000),
      new Date(today.getTime() + 86400000),
      "harvest"
    );

    const headerLine = csv.split("\n")[0];
    expect(headerLine).toContain("Date");
    expect(headerLine).toContain("Client");
    expect(headerLine).toContain("Project");
    expect(headerLine).toContain("Task");
    expect(headerLine).toContain("Notes");
    expect(headerLine).toContain("Hours");
  });

  test("Toggl format has correct headers", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "test.ts",
      screenshotPath: null,
      taskDescription: "Coding",
      projectId: "test-proj",
      manualProjectId: null,
      durationSeconds: 3600,
      isIdle: false,
      aiAnalysis: null,
    });

    const csv = await exportForTimesheetSystem(
      new Date(today.getTime() - 86400000),
      new Date(today.getTime() + 86400000),
      "toggl"
    );

    const headerLine = csv.split("\n")[0];
    expect(headerLine).toContain("Email");
    expect(headerLine).toContain("Project");
    expect(headerLine).toContain("Client");
    expect(headerLine).toContain("Description");
    expect(headerLine).toContain("Start date");
    expect(headerLine).toContain("Start time");
    expect(headerLine).toContain("End date");
    expect(headerLine).toContain("End time");
    expect(headerLine).toContain("Duration");
  });

  test("generic format falls back to standard CSV", async () => {
    const today = new Date();

    const csv = await exportForTimesheetSystem(
      new Date(today.getTime() - 86400000),
      new Date(today.getTime() + 86400000),
      "generic"
    );

    const headerLine = csv.split("\n")[0];
    expect(headerLine).toContain("ID");
    expect(headerLine).toContain("Timestamp");
  });
});

describe("exportWeeklyReport", () => {
  beforeEach(() => {
    testDbPath = getUniqueDbPath();
    initDatabase(testDbPath);
  });

  afterEach(() => {
    closeDatabase();
    cleanupDb(testDbPath);
  });

  test("exports weekly report to CSV format", async () => {
    const weekStart = new Date("2025-01-13");
    const csv = await exportWeeklyReport(weekStart, "csv");

    expect(csv).toContain("WEEKLY REPORT SUMMARY");
    expect(csv).toContain("Week Start");
    expect(csv).toContain("Week End");
    expect(csv).toContain("Total Hours");
  });

  test("exports weekly report to JSON format", async () => {
    const weekStart = new Date("2025-01-13");
    const json = await exportWeeklyReport(weekStart, "json");

    const data = JSON.parse(json);
    expect(data).toHaveProperty("weekStart");
    expect(data).toHaveProperty("weekEnd");
    expect(data).toHaveProperty("totalHours");
    expect(data).toHaveProperty("projects");
    expect(data).toHaveProperty("categories");
    expect(data).toHaveProperty("dailyBreakdown");
  });
});
