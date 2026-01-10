/**
 * Core types for WorkTimeTaskLogger
 */

/** Configuration for the time tracker */
export interface TrackerConfig {
  /** Screenshot capture interval in minutes (default: 5) */
  captureIntervalMinutes: number;

  /** Idle threshold in seconds before pausing (default: 300 = 5 min) */
  idleThresholdSeconds: number;

  /** Directory to store screenshots */
  screenshotDir: string;

  /** Database file path */
  databasePath: string;

  /** Whether to blur screenshots for privacy */
  blurScreenshots: boolean;

  /** Blur intensity (0-100, default: 20) */
  blurIntensity: number;

  /** Apps to exclude from tracking (by name) */
  excludedApps: string[];

  /** Configured projects/clients for categorization */
  projects: Project[];

  /** Whether the tracker is currently running */
  isRunning: boolean;

  /** LLM provider: 'claude-sdk' or 'proxy' */
  llmProvider: "claude-sdk" | "proxy";

  /** Custom LLM proxy URL (OpenAI-compatible) */
  llmProxyUrl: string | null;

  /** Model to use for vision/image analysis */
  llmVisionModel: string;

  /** Model to use for text/summary tasks */
  llmTextModel: string;
}

/** A project or client for categorization */
export interface Project {
  id: string;
  name: string;
  /** Keywords to help AI match activities to this project */
  keywords: string[];
  /** Color for reports (hex) */
  color: string;
  /** Hourly rate for billing (optional) */
  hourlyRate?: number;
  /** Client name (optional) */
  client?: string;
}

/** A captured time entry */
export interface TimeEntry {
  id: number;
  /** Timestamp when captured */
  timestamp: Date;
  /** Active window/app name */
  appName: string;
  /** Window title */
  windowTitle: string;
  /** Screenshot file path (if saved) */
  screenshotPath: string | null;
  /** AI-detected task/activity description */
  taskDescription: string | null;
  /** Matched project ID */
  projectId: string | null;
  /** Manual override of project */
  manualProjectId: string | null;
  /** Duration in seconds (calculated from next entry) */
  durationSeconds: number | null;
  /** Whether user was idle */
  isIdle: boolean;
  /** Raw AI analysis result */
  aiAnalysis: string | null;
}

/** Active window information */
export interface WindowInfo {
  /** Application name */
  appName: string;
  /** Window title */
  title: string;
  /** Bundle identifier (macOS) or process path */
  bundleId: string | null;
  /** Process ID */
  pid: number;
}

/** Result from AI task analysis */
export interface TaskAnalysis {
  /** Brief description of the task/activity */
  taskDescription: string;
  /** Suggested project ID based on context */
  suggestedProjectId: string | null;
  /** Confidence score (0-1) */
  confidence: number;
  /** Category of work (coding, communication, research, etc.) */
  category: WorkCategory;
  /** Additional notes from AI */
  notes: string | null;
}

/** Work categories for classification */
export type WorkCategory =
  | "coding"
  | "communication"
  | "research"
  | "documentation"
  | "meeting"
  | "design"
  | "admin"
  | "break"
  | "other";

/** Daily summary statistics */
export interface DailySummary {
  date: Date;
  totalTrackedSeconds: number;
  idleSeconds: number;
  activeSeconds: number;
  projectBreakdown: ProjectTime[];
  categoryBreakdown: CategoryTime[];
  topApps: AppTime[];
}

/** Time spent on a project */
export interface ProjectTime {
  projectId: string;
  projectName: string;
  seconds: number;
  entries: number;
}

/** Time spent in a category */
export interface CategoryTime {
  category: WorkCategory;
  seconds: number;
  entries: number;
}

/** Time spent in an app */
export interface AppTime {
  appName: string;
  seconds: number;
  entries: number;
}

/** Weekly timesheet report */
export interface WeeklyReport {
  weekStartDate: Date;
  weekEndDate: Date;
  totalHours: number;
  dailySummaries: DailySummary[];
  projectTotals: ProjectTime[];
  categoryTotals: CategoryTime[];
}

/** Export format options */
export type ExportFormat = "csv" | "json";

/** Tracker status */
export interface TrackerStatus {
  isRunning: boolean;
  lastCaptureTime: Date | null;
  totalEntriesToday: number;
  currentProject: string | null;
  nextCaptureIn: number; // seconds
}

/** CLI command options */
export interface CommandOptions {
  config?: string;
  interval?: number;
  output?: string;
  format?: ExportFormat;
  from?: string;
  to?: string;
  projectId?: string;
}
