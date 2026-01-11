/**
 * Export functionality for WorkTimeTaskLogger
 * Supports CSV and JSON export formats
 */

import { getTimeEntries } from "../storage/database.ts";
import { generateWeeklyReport, formatHours } from "./weekly.ts";
import { loadConfig } from "../config/settings.ts";
import type {
  TimeEntry,
  WeeklyReport,
  ExportFormat,
  Project,
} from "../types.ts";

export interface ExportOptions {
  format: ExportFormat;
  startDate: Date;
  endDate: Date;
  projectId?: string;
  includeScreenshots?: boolean;
  outputPath?: string;
}

/**
 * Export time entries to the specified format
 */
export async function exportTimeEntries(
  options: ExportOptions
): Promise<string> {
  const entries = getTimeEntries(
    options.startDate,
    options.endDate,
    options.projectId
  );

  const config = await loadConfig();
  const projectMap = new Map(config.projects.map((p) => [p.id, p]));

  if (options.format === "json") {
    return exportToJSON(entries, projectMap);
  } else {
    return exportToCSV(entries, projectMap, options.includeScreenshots);
  }
}

/**
 * Export entries to JSON format
 */
function exportToJSON(
  entries: TimeEntry[],
  projectMap: Map<string, Project>
): string {
  const exportData = entries.map((entry) => {
    const projectId = entry.manualProjectId ?? entry.projectId;
    const project = projectId ? projectMap.get(projectId) : null;

    return {
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      appName: entry.appName,
      windowTitle: entry.windowTitle,
      taskDescription: entry.taskDescription,
      project: project
        ? {
            id: project.id,
            name: project.name,
            client: project.client,
          }
        : null,
      durationSeconds: entry.durationSeconds,
      durationFormatted: entry.durationSeconds
        ? formatHours(entry.durationSeconds)
        : null,
      isIdle: entry.isIdle,
      screenshotPath: entry.screenshotPath,
    };
  });

  return JSON.stringify(exportData, null, 2);
}

/**
 * Export entries to CSV format
 */
function exportToCSV(
  entries: TimeEntry[],
  projectMap: Map<string, Project>,
  includeScreenshots: boolean = false
): string {
  const headers = [
    "ID",
    "Timestamp",
    "Date",
    "Time",
    "Application",
    "Window Title",
    "Task Description",
    "Project ID",
    "Project Name",
    "Client",
    "Duration (seconds)",
    "Duration (formatted)",
    "Is Idle",
  ];

  if (includeScreenshots) {
    headers.push("Screenshot Path");
  }

  const rows: string[][] = [headers];

  for (const entry of entries) {
    const projectId = entry.manualProjectId ?? entry.projectId;
    const project = projectId ? projectMap.get(projectId) : null;

    const row = [
      entry.id.toString(),
      entry.timestamp.toISOString(),
      entry.timestamp.toLocaleDateString(),
      entry.timestamp.toLocaleTimeString(),
      entry.appName,
      escapeCSV(entry.windowTitle),
      escapeCSV(entry.taskDescription ?? ""),
      projectId ?? "",
      project?.name ?? "",
      project?.client ?? "",
      entry.durationSeconds?.toString() ?? "",
      entry.durationSeconds ? formatHours(entry.durationSeconds) : "",
      entry.isIdle ? "Yes" : "No",
    ];

    if (includeScreenshots) {
      row.push(entry.screenshotPath ?? "");
    }

    rows.push(row);
  }

  return rows.map((row) => row.join(",")).join("\n");
}

/**
 * Escape a value for CSV
 */
export function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export a weekly report
 */
export async function exportWeeklyReport(
  weekStart: Date,
  format: ExportFormat
): Promise<string> {
  const report = await generateWeeklyReport(weekStart);

  if (format === "json") {
    return exportReportToJSON(report);
  } else {
    return exportReportToCSV(report);
  }
}

/**
 * Export weekly report to JSON
 */
function exportReportToJSON(report: WeeklyReport): string {
  return JSON.stringify(
    {
      weekStart: report.weekStartDate.toISOString(),
      weekEnd: report.weekEndDate.toISOString(),
      totalHours: Number(report.totalHours.toFixed(2)),
      projects: report.projectTotals.map((p) => ({
        id: p.projectId,
        name: p.projectName,
        hours: Number((p.seconds / 3600).toFixed(2)),
        entries: p.entries,
      })),
      categories: report.categoryTotals.map((c) => ({
        category: c.category,
        hours: Number((c.seconds / 3600).toFixed(2)),
        entries: c.entries,
      })),
      dailyBreakdown: report.dailySummaries.map((day) => ({
        date: day.date.toISOString().split("T")[0],
        totalHours: Number((day.activeSeconds / 3600).toFixed(2)),
        idleHours: Number((day.idleSeconds / 3600).toFixed(2)),
      })),
    },
    null,
    2
  );
}

/**
 * Export weekly report to CSV
 */
function exportReportToCSV(report: WeeklyReport): string {
  const lines: string[] = [];

  // Summary section
  lines.push("WEEKLY REPORT SUMMARY");
  lines.push(`Week Start,${report.weekStartDate.toISOString().split("T")[0]}`);
  lines.push(`Week End,${report.weekEndDate.toISOString().split("T")[0]}`);
  lines.push(`Total Hours,${report.totalHours.toFixed(2)}`);
  lines.push("");

  // Project breakdown
  lines.push("PROJECT BREAKDOWN");
  lines.push("Project ID,Project Name,Hours,Entries,Percentage");
  for (const project of report.projectTotals) {
    const hours = (project.seconds / 3600).toFixed(2);
    const percentage = ((project.seconds / (report.totalHours * 3600)) * 100).toFixed(1);
    lines.push(
      `${project.projectId},${escapeCSV(project.projectName)},${hours},${project.entries},${percentage}%`
    );
  }
  lines.push("");

  // Daily breakdown
  lines.push("DAILY BREAKDOWN");
  lines.push("Date,Day,Active Hours,Idle Hours,Total Entries");
  for (const day of report.dailySummaries) {
    const dateStr = day.date.toISOString().split("T")[0];
    const dayName = day.date.toLocaleDateString("en-US", { weekday: "short" });
    const activeHours = (day.activeSeconds / 3600).toFixed(2);
    const idleHours = (day.idleSeconds / 3600).toFixed(2);
    const totalEntries = day.projectBreakdown.reduce(
      (sum, p) => sum + p.entries,
      0
    );
    lines.push(`${dateStr},${dayName},${activeHours},${idleHours},${totalEntries}`);
  }
  lines.push("");

  // Category breakdown
  lines.push("CATEGORY BREAKDOWN");
  lines.push("Category,Hours,Entries");
  for (const category of report.categoryTotals) {
    const hours = (category.seconds / 3600).toFixed(2);
    lines.push(`${category.category},${hours},${category.entries}`);
  }

  return lines.join("\n");
}

/**
 * Save export to file
 */
export async function saveExport(
  content: string,
  outputPath: string
): Promise<void> {
  await Bun.write(outputPath, content);
}

/**
 * Generate a default export filename
 */
export function generateExportFilename(
  startDate: Date,
  endDate: Date,
  format: ExportFormat,
  type: "entries" | "report" = "entries"
): string {
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];
  return `timesheet-${type}-${startStr}-to-${endStr}.${format}`;
}

/**
 * Export for common timesheet formats
 */
export async function exportForTimesheetSystem(
  startDate: Date,
  endDate: Date,
  system: "generic" | "harvest" | "toggl"
): Promise<string> {
  const entries = getTimeEntries(startDate, endDate);
  const config = await loadConfig();
  const projectMap = new Map(config.projects.map((p) => [p.id, p]));

  switch (system) {
    case "harvest":
      return exportHarvestFormat(entries, projectMap);
    case "toggl":
      return exportTogglFormat(entries, projectMap);
    default:
      return exportToCSV(entries, projectMap, false);
  }
}

/**
 * Export in Harvest-compatible format
 */
function exportHarvestFormat(
  entries: TimeEntry[],
  projectMap: Map<string, Project>
): string {
  const headers = ["Date", "Client", "Project", "Task", "Notes", "Hours"];
  const rows: string[][] = [headers];

  // Group entries by date and project
  const grouped = new Map<string, Map<string, TimeEntry[]>>();

  for (const entry of entries) {
    if (entry.isIdle) continue;

    const dateKey = entry.timestamp.toISOString().split("T")[0] ?? "";
    const projectId = entry.manualProjectId ?? entry.projectId ?? "unassigned";

    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, new Map());
    }

    const dateGroup = grouped.get(dateKey);
    if (dateGroup) {
      if (!dateGroup.has(projectId)) {
        dateGroup.set(projectId, []);
      }
      dateGroup.get(projectId)?.push(entry);
    }
  }

  // Create rows from grouped data
  for (const [date, projects] of grouped) {
    for (const [projectId, projectEntries] of projects) {
      const project = projectMap.get(projectId);
      const totalSeconds = projectEntries.reduce(
        (sum, e) => sum + (e.durationSeconds ?? 0),
        0
      );
      const hours = (totalSeconds / 3600).toFixed(2);

      // Combine task descriptions
      const tasks = [
        ...new Set(
          projectEntries
            .map((e) => e.taskDescription)
            .filter((t): t is string => t !== null)
        ),
      ];

      rows.push([
        date,
        project?.client ?? "",
        project?.name ?? projectId,
        tasks.slice(0, 3).join("; "),
        "",
        hours,
      ]);
    }
  }

  return rows.map((row) => row.map(escapeCSV).join(",")).join("\n");
}

/**
 * Export in Toggl-compatible format
 */
function exportTogglFormat(
  entries: TimeEntry[],
  projectMap: Map<string, Project>
): string {
  const headers = [
    "Email",
    "Project",
    "Client",
    "Description",
    "Start date",
    "Start time",
    "End date",
    "End time",
    "Duration",
  ];
  const rows: string[][] = [headers];

  for (const entry of entries) {
    if (entry.isIdle || !entry.durationSeconds) continue;

    const projectId = entry.manualProjectId ?? entry.projectId;
    const project = projectId ? projectMap.get(projectId) : null;

    const endTime = new Date(
      entry.timestamp.getTime() + entry.durationSeconds * 1000
    );

    rows.push([
      "", // Email (to be filled by user)
      project?.name ?? "",
      project?.client ?? "",
      entry.taskDescription ?? entry.windowTitle,
      entry.timestamp.toISOString().split("T")[0] ?? "",
      entry.timestamp.toLocaleTimeString("en-US", { hour12: false }),
      endTime.toISOString().split("T")[0] ?? "",
      endTime.toLocaleTimeString("en-US", { hour12: false }),
      formatHours(entry.durationSeconds),
    ]);
  }

  return rows.map((row) => row.map(escapeCSV).join(",")).join("\n");
}
