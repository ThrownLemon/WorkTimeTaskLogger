/**
 * Tests for weekly report generation
 */

import { describe, test, expect } from "bun:test";
import {
  getWeekStart,
  getWeekEnd,
  formatWeeklyReportText,
  formatHours,
  formatDuration,
  calculateWeekChange,
} from "./weekly.ts";
import type { WeeklyReport, DailySummary } from "../types.ts";

describe("getWeekStart", () => {
  test("returns Monday of current week", () => {
    // Test with a known Wednesday: Jan 15, 2025
    const wednesday = new Date("2025-01-15T12:00:00");
    const weekStart = getWeekStart(wednesday);

    expect(weekStart.getDay()).toBe(1); // Monday
    expect(weekStart.getDate()).toBe(13); // Jan 13, 2025
    expect(weekStart.getHours()).toBe(0);
    expect(weekStart.getMinutes()).toBe(0);
    expect(weekStart.getSeconds()).toBe(0);
  });

  test("handles Monday input (returns same day)", () => {
    const monday = new Date("2025-01-13T12:00:00");
    const weekStart = getWeekStart(monday);

    expect(weekStart.getDay()).toBe(1);
    expect(weekStart.getDate()).toBe(13);
  });

  test("handles Sunday input (returns previous Monday)", () => {
    const sunday = new Date("2025-01-19T12:00:00");
    const weekStart = getWeekStart(sunday);

    expect(weekStart.getDay()).toBe(1);
    expect(weekStart.getDate()).toBe(13); // Previous Monday
  });

  test("handles Saturday input", () => {
    const saturday = new Date("2025-01-18T12:00:00");
    const weekStart = getWeekStart(saturday);

    expect(weekStart.getDay()).toBe(1);
    expect(weekStart.getDate()).toBe(13);
  });

  test("returns current week when called without argument", () => {
    const weekStart = getWeekStart();
    expect(weekStart.getDay()).toBe(1); // Monday
    expect(weekStart.getHours()).toBe(0);
  });
});

describe("getWeekEnd", () => {
  test("returns Sunday of the week", () => {
    const weekStart = new Date("2025-01-13T00:00:00"); // Monday
    const weekEnd = getWeekEnd(weekStart);

    expect(weekEnd.getDay()).toBe(0); // Sunday
    expect(weekEnd.getDate()).toBe(19); // Jan 19, 2025
    expect(weekEnd.getHours()).toBe(23);
    expect(weekEnd.getMinutes()).toBe(59);
    expect(weekEnd.getSeconds()).toBe(59);
  });

  test("is 6 days after week start", () => {
    const weekStart = new Date("2025-01-13T00:00:00");
    const weekEnd = getWeekEnd(weekStart);

    const daysDiff =
      (weekEnd.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeCloseTo(6.999, 2); // ~7 days minus 1 second
  });
});

describe("formatHours", () => {
  test("formats seconds to minutes only", () => {
    expect(formatHours(60)).toBe("1m");
    expect(formatHours(120)).toBe("2m");
    expect(formatHours(1800)).toBe("30m");
    expect(formatHours(3540)).toBe("59m");
  });

  test("formats seconds to hours only", () => {
    expect(formatHours(3600)).toBe("1h");
    expect(formatHours(7200)).toBe("2h");
    expect(formatHours(36000)).toBe("10h");
  });

  test("formats seconds to hours and minutes", () => {
    expect(formatHours(3660)).toBe("1h 1m");
    expect(formatHours(5400)).toBe("1h 30m");
    expect(formatHours(7320)).toBe("2h 2m");
  });

  test("handles zero seconds", () => {
    expect(formatHours(0)).toBe("0m");
  });

  test("handles less than a minute", () => {
    expect(formatHours(30)).toBe("0m");
    expect(formatHours(59)).toBe("0m");
  });
});

describe("formatDuration", () => {
  test("formats as HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(1)).toBe("00:00:01");
    expect(formatDuration(60)).toBe("00:01:00");
    expect(formatDuration(3600)).toBe("01:00:00");
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  test("handles large values", () => {
    expect(formatDuration(36000)).toBe("10:00:00");
    expect(formatDuration(86399)).toBe("23:59:59");
  });

  test("pads single digits", () => {
    expect(formatDuration(61)).toBe("00:01:01");
    expect(formatDuration(3665)).toBe("01:01:05");
  });
});

describe("formatWeeklyReportText", () => {
  const mockReport: WeeklyReport = {
    weekStartDate: new Date("2025-01-13"),
    weekEndDate: new Date("2025-01-19"),
    totalHours: 40.5,
    dailySummaries: [
      {
        date: new Date("2025-01-13"),
        totalTrackedSeconds: 32400,
        idleSeconds: 3600,
        activeSeconds: 28800, // 8 hours
        projectBreakdown: [],
        categoryBreakdown: [],
        topApps: [],
      },
      {
        date: new Date("2025-01-14"),
        totalTrackedSeconds: 30600,
        idleSeconds: 1800,
        activeSeconds: 28800,
        projectBreakdown: [],
        categoryBreakdown: [],
        topApps: [],
      },
    ],
    projectTotals: [
      { projectId: "proj-1", projectName: "Project Alpha", seconds: 72000, entries: 20 },
      { projectId: "proj-2", projectName: "Project Beta", seconds: 36000, entries: 10 },
    ],
    categoryTotals: [
      { category: "coding", seconds: 54000, entries: 15 },
      { category: "communication", seconds: 18000, entries: 5 },
    ],
  };

  test("includes header", () => {
    const text = formatWeeklyReportText(mockReport);
    expect(text).toContain("WEEKLY TIMESHEET REPORT");
  });

  test("includes date range", () => {
    const text = formatWeeklyReportText(mockReport);
    expect(text).toContain("Week:");
    expect(text).toContain("2025");
  });

  test("includes total hours", () => {
    const text = formatWeeklyReportText(mockReport);
    expect(text).toContain("Total Hours:");
    expect(text).toContain("40.50");
  });

  test("includes project breakdown section", () => {
    const text = formatWeeklyReportText(mockReport);
    expect(text).toContain("PROJECT BREAKDOWN");
    expect(text).toContain("Project Alpha");
    expect(text).toContain("Project Beta");
  });

  test("includes daily breakdown section", () => {
    const text = formatWeeklyReportText(mockReport);
    expect(text).toContain("DAILY BREAKDOWN");
    expect(text).toContain("Mon");
    expect(text).toContain("Tue");
  });

  test("includes category breakdown section", () => {
    const text = formatWeeklyReportText(mockReport);
    expect(text).toContain("CATEGORY BREAKDOWN");
    expect(text).toContain("coding");
    expect(text).toContain("communication");
  });
});

describe("calculateWeekChange", () => {
  const createMockReport = (
    totalHours: number,
    projects: Array<{ id: string; seconds: number }>
  ): WeeklyReport => ({
    weekStartDate: new Date(),
    weekEndDate: new Date(),
    totalHours,
    dailySummaries: [],
    projectTotals: projects.map((p) => ({
      projectId: p.id,
      projectName: p.id,
      seconds: p.seconds,
      entries: 1,
    })),
    categoryTotals: [],
  });

  test("calculates positive hours change", () => {
    const current = createMockReport(45, []);
    const previous = createMockReport(40, []);

    const change = calculateWeekChange(current, previous);
    expect(change.hoursChange).toBe(5);
    expect(change.hoursChangePercent).toBeCloseTo(12.5, 1);
  });

  test("calculates negative hours change", () => {
    const current = createMockReport(35, []);
    const previous = createMockReport(40, []);

    const change = calculateWeekChange(current, previous);
    expect(change.hoursChange).toBe(-5);
    expect(change.hoursChangePercent).toBeCloseTo(-12.5, 1);
  });

  test("handles zero previous hours", () => {
    const current = createMockReport(40, []);
    const previous = createMockReport(0, []);

    const change = calculateWeekChange(current, previous);
    expect(change.hoursChange).toBe(40);
    expect(change.hoursChangePercent).toBe(0); // Avoid division by zero
  });

  test("calculates project changes", () => {
    const current = createMockReport(40, [
      { id: "proj-1", seconds: 36000 }, // 10 hours
      { id: "proj-2", seconds: 18000 }, // 5 hours
    ]);
    const previous = createMockReport(35, [
      { id: "proj-1", seconds: 28800 }, // 8 hours
    ]);

    const change = calculateWeekChange(current, previous);
    expect(change.projectChanges.get("proj-1")).toBeCloseTo(2, 0); // 10 - 8 = 2 hours
    expect(change.projectChanges.get("proj-2")).toBeCloseTo(5, 0); // 5 - 0 = 5 hours (new project)
  });
});
