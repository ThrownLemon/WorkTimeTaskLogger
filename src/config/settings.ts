/**
 * Configuration management for WorkTimeTaskLogger
 */

import { join, dirname } from "path";
import type { TrackerConfig, Project } from "../types.ts";
import { logger, formatError } from "../utils/logger.ts";

const DEFAULT_DATA_DIR = join(process.cwd(), "data");

/** Default configuration */
export const DEFAULT_CONFIG: TrackerConfig = {
  captureIntervalMinutes: 5,
  idleThresholdSeconds: 300, // 5 minutes
  screenshotDir: join(DEFAULT_DATA_DIR, "screenshots"),
  databasePath: join(DEFAULT_DATA_DIR, "timetracker.db"),
  blurScreenshots: false,
  blurIntensity: 20,
  excludedApps: [],
  projects: [],
  isRunning: false,
  llmProvider: "proxy",
  llmProxyUrl: "https://proxy.traviswinsor.com",
  llmVisionModel: "gemini-3-flash-preview",
  llmTextModel: "gemini-3-flash-preview",
};

const CONFIG_FILE = join(DEFAULT_DATA_DIR, "config.json");

/**
 * Load configuration from file or return defaults
 */
export async function loadConfig(): Promise<TrackerConfig> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      const data = await file.json();
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (error) {
    logger.error(`Error loading config, using defaults: ${formatError(error)}`);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: TrackerConfig): Promise<void> {
  // Ensure data directory exists
  const dir = dirname(CONFIG_FILE);
  await Bun.$`mkdir -p ${dir}`.quiet();

  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Update specific config values
 */
export async function updateConfig(
  updates: Partial<TrackerConfig>
): Promise<TrackerConfig> {
  const current = await loadConfig();
  const updated = { ...current, ...updates };
  await saveConfig(updated);
  return updated;
}

/**
 * Add a project to the configuration
 */
export async function addProject(project: Project): Promise<TrackerConfig> {
  const config = await loadConfig();

  // Check for duplicate ID
  if (config.projects.some((p) => p.id === project.id)) {
    throw new Error(`Project with ID "${project.id}" already exists`);
  }

  config.projects.push(project);
  await saveConfig(config);
  return config;
}

/**
 * Remove a project from the configuration
 */
export async function removeProject(projectId: string): Promise<TrackerConfig> {
  const config = await loadConfig();
  config.projects = config.projects.filter((p) => p.id !== projectId);
  await saveConfig(config);
  return config;
}

/**
 * Update an existing project
 */
export async function updateProject(
  projectId: string,
  updates: Partial<Project>
): Promise<TrackerConfig> {
  const config = await loadConfig();
  const index = config.projects.findIndex((p) => p.id === projectId);

  if (index === -1) {
    throw new Error(`Project with ID "${projectId}" not found`);
  }

  const existingProject = config.projects[index];
  if (existingProject) {
    config.projects[index] = { ...existingProject, ...updates };
  }
  await saveConfig(config);
  return config;
}

/**
 * Get a project by ID
 */
export async function getProject(projectId: string): Promise<Project | null> {
  const config = await loadConfig();
  return config.projects.find((p) => p.id === projectId) ?? null;
}

/**
 * Ensure required directories exist
 */
export async function ensureDirectories(config: TrackerConfig): Promise<void> {
  await Bun.$`mkdir -p ${config.screenshotDir}`.quiet();
  await Bun.$`mkdir -p ${dirname(config.databasePath)}`.quiet();
}

/**
 * Generate a unique project ID
 */
export function generateProjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${slug}-${suffix}`;
}

/**
 * Validate configuration
 */
export function validateConfig(config: Partial<TrackerConfig>): string[] {
  const errors: string[] = [];

  if (
    config.captureIntervalMinutes !== undefined &&
    (config.captureIntervalMinutes < 1 || config.captureIntervalMinutes > 60)
  ) {
    errors.push("Capture interval must be between 1 and 60 minutes");
  }

  if (
    config.idleThresholdSeconds !== undefined &&
    (config.idleThresholdSeconds < 30 || config.idleThresholdSeconds > 3600)
  ) {
    errors.push("Idle threshold must be between 30 and 3600 seconds");
  }

  if (
    config.blurIntensity !== undefined &&
    (config.blurIntensity < 0 || config.blurIntensity > 100)
  ) {
    errors.push("Blur intensity must be between 0 and 100");
  }

  return errors;
}
