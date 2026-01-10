/**
 * SQLite database layer for WorkTimeTaskLogger
 * Uses Bun's built-in SQLite support
 */

import { Database } from "bun:sqlite";
import type {
  TimeEntry,
  DailySummary,
  ProjectTime,
  CategoryTime,
  AppTime,
  WorkCategory,
} from "../types.ts";

let db: Database | null = null;

/**
 * Initialize the database connection and create tables
 */
export function initDatabase(dbPath: string): Database {
  db = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrency
  db.run("PRAGMA journal_mode = WAL");

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      app_name TEXT NOT NULL,
      window_title TEXT NOT NULL,
      screenshot_path TEXT,
      task_description TEXT,
      project_id TEXT,
      manual_project_id TEXT,
      duration_seconds INTEGER,
      is_idle INTEGER NOT NULL DEFAULT 0,
      ai_analysis TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indices for common queries
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON time_entries(timestamp)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_entries_project ON time_entries(project_id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_entries_app ON time_entries(app_name)"
  );

  return db;
}

/**
 * Get the database instance
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase first.");
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Insert a new time entry
 */
export function insertTimeEntry(
  entry: Omit<TimeEntry, "id">
): number {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO time_entries (
      timestamp, app_name, window_title, screenshot_path,
      task_description, project_id, manual_project_id,
      duration_seconds, is_idle, ai_analysis
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    entry.timestamp.toISOString(),
    entry.appName,
    entry.windowTitle,
    entry.screenshotPath,
    entry.taskDescription,
    entry.projectId,
    entry.manualProjectId,
    entry.durationSeconds,
    entry.isIdle ? 1 : 0,
    entry.aiAnalysis
  );

  return Number(result.lastInsertRowid);
}

/**
 * Update the duration of the previous entry
 */
export function updatePreviousEntryDuration(
  currentTimestamp: Date
): void {
  const database = getDatabase();

  // Get the most recent entry
  const lastEntry = database
    .query<{ id: number; timestamp: string }, []>(
      "SELECT id, timestamp FROM time_entries ORDER BY timestamp DESC LIMIT 1"
    )
    .get();

  if (lastEntry) {
    const lastTime = new Date(lastEntry.timestamp);
    const durationSeconds = Math.floor(
      (currentTimestamp.getTime() - lastTime.getTime()) / 1000
    );

    database.run(
      "UPDATE time_entries SET duration_seconds = ? WHERE id = ?",
      [durationSeconds, lastEntry.id]
    );
  }
}

/**
 * Get time entries within a date range
 */
export function getTimeEntries(
  startDate: Date,
  endDate: Date,
  projectId?: string
): TimeEntry[] {
  const database = getDatabase();

  let query = `
    SELECT * FROM time_entries
    WHERE timestamp >= ? AND timestamp < ?
  `;
  const params: (string | null)[] = [
    startDate.toISOString(),
    endDate.toISOString(),
  ];

  if (projectId) {
    query += " AND (project_id = ? OR manual_project_id = ?)";
    params.push(projectId, projectId);
  }

  query += " ORDER BY timestamp ASC";

  const rows = database
    .query<RawTimeEntry, (string | null)[]>(query)
    .all(...params);

  return rows.map(rowToTimeEntry);
}

/**
 * Get today's time entries
 */
export function getTodayEntries(): TimeEntry[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return getTimeEntries(today, tomorrow);
}

/**
 * Get daily summary for a specific date
 */
export function getDailySummary(date: Date): DailySummary {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const entries = getTimeEntries(startOfDay, endOfDay);

  // Calculate totals
  let totalTrackedSeconds = 0;
  let idleSeconds = 0;
  let activeSeconds = 0;

  const projectMap = new Map<string, { seconds: number; entries: number }>();
  const categoryMap = new Map<
    WorkCategory,
    { seconds: number; entries: number }
  >();
  const appMap = new Map<string, { seconds: number; entries: number }>();

  for (const entry of entries) {
    const duration = entry.durationSeconds ?? 0;
    totalTrackedSeconds += duration;

    if (entry.isIdle) {
      idleSeconds += duration;
    } else {
      activeSeconds += duration;

      // Project breakdown
      const projectId = entry.manualProjectId ?? entry.projectId ?? "unassigned";
      const projectData = projectMap.get(projectId) ?? {
        seconds: 0,
        entries: 0,
      };
      projectData.seconds += duration;
      projectData.entries++;
      projectMap.set(projectId, projectData);

      // App breakdown
      const appData = appMap.get(entry.appName) ?? { seconds: 0, entries: 0 };
      appData.seconds += duration;
      appData.entries++;
      appMap.set(entry.appName, appData);
    }
  }

  // Convert maps to arrays
  const projectBreakdown: ProjectTime[] = Array.from(projectMap.entries()).map(
    ([id, data]) => ({
      projectId: id,
      projectName: id, // Will be resolved by caller
      seconds: data.seconds,
      entries: data.entries,
    })
  );

  const categoryBreakdown: CategoryTime[] = Array.from(
    categoryMap.entries()
  ).map(([category, data]) => ({
    category,
    seconds: data.seconds,
    entries: data.entries,
  }));

  const topApps: AppTime[] = Array.from(appMap.entries())
    .map(([appName, data]) => ({
      appName,
      seconds: data.seconds,
      entries: data.entries,
    }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 10);

  return {
    date: startOfDay,
    totalTrackedSeconds,
    idleSeconds,
    activeSeconds,
    projectBreakdown,
    categoryBreakdown,
    topApps,
  };
}

/**
 * Update the task analysis for an entry
 */
export function updateEntryAnalysis(
  entryId: number,
  taskDescription: string,
  projectId: string | null,
  aiAnalysis: string
): void {
  const database = getDatabase();

  database.run(
    `UPDATE time_entries
     SET task_description = ?, project_id = ?, ai_analysis = ?
     WHERE id = ?`,
    [taskDescription, projectId, aiAnalysis, entryId]
  );
}

/**
 * Set manual project for an entry
 */
export function setManualProject(
  entryId: number,
  projectId: string
): void {
  const database = getDatabase();
  database.run(
    "UPDATE time_entries SET manual_project_id = ? WHERE id = ?",
    [projectId, entryId]
  );
}

/**
 * Get count of entries for today
 */
export function getTodayEntryCount(): number {
  const database = getDatabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = database
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM time_entries WHERE timestamp >= ?"
    )
    .get(today.toISOString());

  return result?.count ?? 0;
}

/**
 * Get the last entry
 */
export function getLastEntry(): TimeEntry | null {
  const database = getDatabase();

  const row = database
    .query<RawTimeEntry, []>(
      "SELECT * FROM time_entries ORDER BY timestamp DESC LIMIT 1"
    )
    .get();

  return row ? rowToTimeEntry(row) : null;
}

/**
 * Delete entries older than specified days
 */
export function deleteOldEntries(retentionDays: number): number {
  const database = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = database.run(
    "DELETE FROM time_entries WHERE timestamp < ?",
    [cutoffDate.toISOString()]
  );

  return result.changes;
}

// Helper types and functions

interface RawTimeEntry {
  id: number;
  timestamp: string;
  app_name: string;
  window_title: string;
  screenshot_path: string | null;
  task_description: string | null;
  project_id: string | null;
  manual_project_id: string | null;
  duration_seconds: number | null;
  is_idle: number;
  ai_analysis: string | null;
}

function rowToTimeEntry(row: RawTimeEntry): TimeEntry {
  return {
    id: row.id,
    timestamp: new Date(row.timestamp),
    appName: row.app_name,
    windowTitle: row.window_title,
    screenshotPath: row.screenshot_path,
    taskDescription: row.task_description,
    projectId: row.project_id,
    manualProjectId: row.manual_project_id,
    durationSeconds: row.duration_seconds,
    isIdle: row.is_idle === 1,
    aiAnalysis: row.ai_analysis,
  };
}
