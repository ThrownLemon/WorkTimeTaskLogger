/**
 * Weekly report generation for WorkTimeTaskLogger
 */

import {
  getTimeEntries,
  getDailySummary,
} from "../storage/database.ts";
import { generateWeeklySummary } from "../agent.ts";
import { loadConfig } from "../config/settings.ts";
import type {
  WeeklyReport,
  DailySummary,
  ProjectTime,
  CategoryTime,
  Project,
} from "../types.ts";

/**
 * Get the start of the current week (Monday)
 */
export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the week (Sunday 23:59:59)
 */
export function getWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Generate a weekly report
 */
export async function generateWeeklyReport(
  weekStartDate?: Date
): Promise<WeeklyReport> {
  const weekStart = weekStartDate ?? getWeekStart();
  const weekEnd = getWeekEnd(weekStart);

  const config = await loadConfig();
  const projectMap = new Map(config.projects.map((p) => [p.id, p]));

  // Get daily summaries for each day of the week
  const dailySummaries: DailySummary[] = [];
  const currentDate = new Date(weekStart);

  while (currentDate <= weekEnd) {
    const summary = getDailySummary(currentDate);
    dailySummaries.push(summary);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Aggregate project totals
  const projectTotalsMap = new Map<
    string,
    { seconds: number; entries: number }
  >();
  const categoryTotalsMap = new Map<
    string,
    { seconds: number; entries: number }
  >();

  for (const day of dailySummaries) {
    for (const project of day.projectBreakdown) {
      const existing = projectTotalsMap.get(project.projectId) ?? {
        seconds: 0,
        entries: 0,
      };
      existing.seconds += project.seconds;
      existing.entries += project.entries;
      projectTotalsMap.set(project.projectId, existing);
    }

    for (const category of day.categoryBreakdown) {
      const existing = categoryTotalsMap.get(category.category) ?? {
        seconds: 0,
        entries: 0,
      };
      existing.seconds += category.seconds;
      existing.entries += category.entries;
      categoryTotalsMap.set(category.category, existing);
    }
  }

  // Convert to arrays and resolve project names
  const projectTotals: ProjectTime[] = Array.from(
    projectTotalsMap.entries()
  ).map(([id, data]) => ({
    projectId: id,
    projectName: projectMap.get(id)?.name ?? id,
    seconds: data.seconds,
    entries: data.entries,
  }));

  const categoryTotals: CategoryTime[] = Array.from(
    categoryTotalsMap.entries()
  ).map(([category, data]) => ({
    category: category as CategoryTime["category"],
    seconds: data.seconds,
    entries: data.entries,
  }));

  // Calculate total hours
  const totalSeconds = dailySummaries.reduce(
    (sum, day) => sum + day.activeSeconds,
    0
  );

  return {
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    totalHours: totalSeconds / 3600,
    dailySummaries,
    projectTotals: projectTotals.sort((a, b) => b.seconds - a.seconds),
    categoryTotals: categoryTotals.sort((a, b) => b.seconds - a.seconds),
  };
}

/**
 * Format weekly report as text
 */
export function formatWeeklyReportText(report: WeeklyReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push("WEEKLY TIMESHEET REPORT");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(
    `Week: ${formatDate(report.weekStartDate)} - ${formatDate(report.weekEndDate)}`
  );
  lines.push(`Total Hours: ${report.totalHours.toFixed(2)}`);
  lines.push("");

  // Project breakdown
  lines.push("-".repeat(40));
  lines.push("PROJECT BREAKDOWN");
  lines.push("-".repeat(40));

  for (const project of report.projectTotals) {
    const hours = (project.seconds / 3600).toFixed(2);
    const percentage = ((project.seconds / (report.totalHours * 3600)) * 100).toFixed(1);
    lines.push(`  ${project.projectName.padEnd(25)} ${hours.padStart(8)}h (${percentage}%)`);
  }

  lines.push("");

  // Daily breakdown
  lines.push("-".repeat(40));
  lines.push("DAILY BREAKDOWN");
  lines.push("-".repeat(40));

  for (const day of report.dailySummaries) {
    const dayName = day.date.toLocaleDateString("en-US", { weekday: "short" });
    const dateStr = formatDate(day.date);
    const hours = (day.activeSeconds / 3600).toFixed(2);
    lines.push(`  ${dayName} ${dateStr}: ${hours}h`);
  }

  lines.push("");

  // Category breakdown
  lines.push("-".repeat(40));
  lines.push("CATEGORY BREAKDOWN");
  lines.push("-".repeat(40));

  for (const category of report.categoryTotals) {
    const hours = (category.seconds / 3600).toFixed(2);
    lines.push(`  ${category.category.padEnd(20)} ${hours.padStart(8)}h`);
  }

  lines.push("");
  lines.push("=".repeat(60));

  return lines.join("\n");
}

/**
 * Generate an AI-powered summary of the week
 */
export async function generateAISummary(
  report: WeeklyReport
): Promise<string> {
  const projectBreakdown = report.projectTotals.map((p) => ({
    name: p.projectName,
    hours: p.seconds / 3600,
  }));

  const topActivities = report.categoryTotals
    .slice(0, 5)
    .map((c) => `${c.category}: ${(c.seconds / 3600).toFixed(1)}h`);

  return generateWeeklySummary({
    totalHours: report.totalHours,
    projectBreakdown,
    topActivities,
  });
}

/**
 * Get previous weeks' reports for comparison
 */
export async function getPreviousWeeksReports(
  numWeeks: number = 4
): Promise<WeeklyReport[]> {
  const reports: WeeklyReport[] = [];
  const currentWeekStart = getWeekStart();

  for (let i = 1; i <= numWeeks; i++) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() - i * 7);
    const report = await generateWeeklyReport(weekStart);
    reports.push(report);
  }

  return reports;
}

/**
 * Calculate week-over-week change
 */
export function calculateWeekChange(
  currentWeek: WeeklyReport,
  previousWeek: WeeklyReport
): {
  hoursChange: number;
  hoursChangePercent: number;
  projectChanges: Map<string, number>;
} {
  const hoursChange = currentWeek.totalHours - previousWeek.totalHours;
  const hoursChangePercent =
    previousWeek.totalHours > 0
      ? (hoursChange / previousWeek.totalHours) * 100
      : 0;

  const projectChanges = new Map<string, number>();

  // Build previous week's project map
  const prevProjectMap = new Map(
    previousWeek.projectTotals.map((p) => [p.projectId, p.seconds / 3600])
  );

  // Calculate changes for each project
  for (const project of currentWeek.projectTotals) {
    const prevHours = prevProjectMap.get(project.projectId) ?? 0;
    const currentHours = project.seconds / 3600;
    projectChanges.set(project.projectId, currentHours - prevHours);
  }

  return {
    hoursChange,
    hoursChangePercent,
    projectChanges,
  };
}

// Helper functions

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format hours for display
 */
export function formatHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes}m`;
  } else if (minutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Format duration as HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    secs.toString().padStart(2, "0"),
  ].join(":");
}
