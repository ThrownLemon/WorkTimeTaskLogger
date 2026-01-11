/**
 * Tests for database.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import {
  initDatabase,
  closeDatabase,
  insertTimeEntry,
  getDailySummary,
  updateEntryAnalysis,
} from "./database.ts";

// Use unique DB path per test to avoid conflicts
let testDbPath: string;
let testId = 0;

function getUniqueDbPath(): string {
  return join(import.meta.dir, `../../data/test-timetracker-${Date.now()}-${++testId}.db`);
}

function cleanupDb(dbPath: string): void {
  // Clean up all SQLite files (main, WAL, SHM)
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

describe("getDailySummary", () => {
  beforeEach(() => {
    testDbPath = getUniqueDbPath();
    initDatabase(testDbPath);
  });

  afterEach(() => {
    closeDatabase();
    cleanupDb(testDbPath);
  });

  test("categoryBreakdown is populated from aiAnalysis", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    // Insert entries with different categories
    const entry1Id = insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "index.ts - project",
      screenshotPath: null,
      taskDescription: "Writing code",
      projectId: "test-project",
      manualProjectId: null,
      durationSeconds: 3600, // 1 hour
      isIdle: false,
      aiAnalysis: JSON.stringify({
        taskDescription: "Writing code",
        suggestedProjectId: "test-project",
        confidence: 0.9,
        category: "coding",
        notes: null,
      }),
    });

    const entry2Timestamp = new Date(today);
    entry2Timestamp.setHours(13, 0, 0, 0);

    const entry2Id = insertTimeEntry({
      timestamp: entry2Timestamp,
      appName: "Slack",
      windowTitle: "Team Channel",
      screenshotPath: null,
      taskDescription: "Team discussion",
      projectId: "test-project",
      manualProjectId: null,
      durationSeconds: 1800, // 30 minutes
      isIdle: false,
      aiAnalysis: JSON.stringify({
        taskDescription: "Team discussion",
        suggestedProjectId: "test-project",
        confidence: 0.85,
        category: "communication",
        notes: null,
      }),
    });

    const entry3Timestamp = new Date(today);
    entry3Timestamp.setHours(14, 0, 0, 0);

    const entry3Id = insertTimeEntry({
      timestamp: entry3Timestamp,
      appName: "VS Code",
      windowTitle: "app.ts - project",
      screenshotPath: null,
      taskDescription: "More coding",
      projectId: "test-project",
      manualProjectId: null,
      durationSeconds: 1800, // 30 minutes
      isIdle: false,
      aiAnalysis: JSON.stringify({
        taskDescription: "More coding",
        suggestedProjectId: "test-project",
        confidence: 0.95,
        category: "coding",
        notes: null,
      }),
    });

    // Get daily summary
    const summary = getDailySummary(today);

    // Verify categoryBreakdown is populated
    expect(summary.categoryBreakdown.length).toBeGreaterThan(0);

    // Find coding category
    const codingCategory = summary.categoryBreakdown.find(
      (c) => c.category === "coding"
    );
    expect(codingCategory).toBeDefined();
    expect(codingCategory!.seconds).toBe(5400); // 1.5 hours = 5400 seconds
    expect(codingCategory!.entries).toBe(2);

    // Find communication category
    const commCategory = summary.categoryBreakdown.find(
      (c) => c.category === "communication"
    );
    expect(commCategory).toBeDefined();
    expect(commCategory!.seconds).toBe(1800); // 30 minutes
    expect(commCategory!.entries).toBe(1);
  });

  test("categoryBreakdown handles entries without aiAnalysis", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    // Insert entry without aiAnalysis
    insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "index.ts",
      screenshotPath: null,
      taskDescription: null,
      projectId: null,
      manualProjectId: null,
      durationSeconds: 3600,
      isIdle: false,
      aiAnalysis: null, // No AI analysis
    });

    // Should not throw, categoryBreakdown should be empty
    const summary = getDailySummary(today);
    expect(summary.categoryBreakdown).toEqual([]);
  });

  test("categoryBreakdown handles invalid JSON in aiAnalysis", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    // Insert entry with invalid JSON
    insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "index.ts",
      screenshotPath: null,
      taskDescription: null,
      projectId: null,
      manualProjectId: null,
      durationSeconds: 3600,
      isIdle: false,
      aiAnalysis: "not valid json",
    });

    // Should not throw, categoryBreakdown should be empty
    const summary = getDailySummary(today);
    expect(summary.categoryBreakdown).toEqual([]);
  });

  test("idle entries are not included in categoryBreakdown", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    // Insert idle entry with category
    insertTimeEntry({
      timestamp: today,
      appName: "VS Code",
      windowTitle: "index.ts",
      screenshotPath: null,
      taskDescription: "Coding",
      projectId: null,
      manualProjectId: null,
      durationSeconds: 3600,
      isIdle: true, // Idle entry
      aiAnalysis: JSON.stringify({
        taskDescription: "Coding",
        suggestedProjectId: null,
        confidence: 0.9,
        category: "coding",
        notes: null,
      }),
    });

    const summary = getDailySummary(today);
    // Idle entries should not be in categoryBreakdown
    expect(summary.categoryBreakdown).toEqual([]);
    expect(summary.idleSeconds).toBe(3600);
  });
});
