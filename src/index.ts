#!/usr/bin/env bun
/**
 * WorkTimeTaskLogger - AI-powered time tracking agent
 * Main entry point and CLI
 */

import { parseArgs } from "util";
import {
  loadConfig,
  saveConfig,
  updateConfig,
  addProject,
  removeProject,
  ensureDirectories,
  generateProjectId,
  validateConfig,
} from "./config/settings.ts";
import {
  initDatabase,
  closeDatabase,
  insertTimeEntry,
  updatePreviousEntryDuration,
  getTodayEntryCount,
  getLastEntry,
  updateEntryAnalysis,
} from "./storage/database.ts";
import { captureScreenshot } from "./capture/screenshot.ts";
import {
  getActiveWindow,
  shouldExcludeWindow,
  categorizeApp,
  extractWindowContext,
} from "./capture/window.ts";
import { checkIdleState, createIdleWatcher, formatIdleTime } from "./capture/idle.ts";
import { analyzeTask } from "./agent.ts";
import {
  generateWeeklyReport,
  formatWeeklyReportText,
  generateAISummary,
  getWeekStart,
} from "./reports/weekly.ts";
import {
  exportTimeEntries,
  exportWeeklyReport,
  saveExport,
  generateExportFilename,
} from "./reports/export.ts";
import type { TrackerConfig, Project, ExportFormat } from "./types.ts";
import { logger } from "./utils/logger.ts";

// CLI commands
const COMMANDS = {
  start: "Start the time tracker",
  stop: "Stop the time tracker",
  status: "Show tracker status",
  report: "Generate weekly report",
  export: "Export time entries",
  projects: "Manage projects",
  config: "View or update configuration",
  help: "Show this help message",
};

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  try {
    switch (command) {
      case "start":
        await startTracker();
        break;
      case "stop":
        await stopTracker();
        break;
      case "status":
        await showStatus();
        break;
      case "report":
        await generateReport(args.slice(1));
        break;
      case "export":
        await handleExport(args.slice(1));
        break;
      case "projects":
        await handleProjects(args.slice(1));
        break;
      case "config":
        await handleConfig(args.slice(1));
        break;
      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Start the time tracker
 */
async function startTracker(): Promise<void> {
  logger.info("Starting WorkTimeTaskLogger...\n");

  const config = await loadConfig();
  await ensureDirectories(config);
  initDatabase(config.databasePath);

  // Check if already running
  if (config.isRunning) {
    logger.warning("Tracker is already running.");
    return;
  }

  // Mark as running
  await updateConfig({ isRunning: true });

  logger.info(`Capture interval: ${config.captureIntervalMinutes} minutes`);
  logger.info(`Idle threshold: ${config.idleThresholdSeconds} seconds`);
  logger.info(`Screenshot blur: ${config.blurScreenshots ? "enabled" : "disabled"}`);
  logger.info(`Projects configured: ${config.projects.length}`);
  logger.plain("");

  // Set up idle watcher
  const idleWatcher = createIdleWatcher(config, (isIdle, idleSeconds) => {
    if (isIdle) {
      logger.warning(`[${new Date().toLocaleTimeString()}] User is idle (${formatIdleTime(idleSeconds)})`);
    } else {
      logger.info(`[${new Date().toLocaleTimeString()}] User is active again`);
    }
  });

  idleWatcher.start();

  // Capture loop
  const intervalMs = config.captureIntervalMinutes * 60 * 1000;

  logger.success("Tracker started. Press Ctrl+C to stop.\n");

  // Initial capture
  await captureAndAnalyze(config);

  // Set up interval
  const timer = setInterval(async () => {
    await captureAndAnalyze(config);
  }, intervalMs);

  // Handle shutdown
  const shutdown = async () => {
    logger.info("\nStopping tracker...");
    clearInterval(timer);
    idleWatcher.stop();
    await updateConfig({ isRunning: false });
    closeDatabase();
    logger.success("Tracker stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process running
  await new Promise(() => {});
}

/**
 * Capture screenshot and analyze
 */
async function captureAndAnalyze(config: TrackerConfig): Promise<void> {
  const now = new Date();
  const timeStr = now.toLocaleTimeString();

  try {
    // Check if idle
    const idleState = await checkIdleState(config);
    if (idleState.isIdle) {
      logger.warning(`[${timeStr}] Skipping capture - user is idle`);
      return;
    }

    // Get active window
    const windowInfo = await getActiveWindow();
    if (!windowInfo) {
      logger.warning(`[${timeStr}] No active window detected`);
      return;
    }

    // Check if excluded
    if (shouldExcludeWindow(windowInfo, config)) {
      logger.warning(`[${timeStr}] Skipping excluded app: ${windowInfo.appName}`);
      return;
    }

    // Update duration of previous entry
    updatePreviousEntryDuration(now);

    // Capture screenshot
    let screenshotPath: string | null = null;
    try {
      const screenshot = await captureScreenshot(config);
      screenshotPath = screenshot.filePath;
    } catch (error) {
      logger.warning(`[${timeStr}] Screenshot capture failed: ${error}`);
    }

    // Insert initial entry
    const entryId = insertTimeEntry({
      timestamp: now,
      appName: windowInfo.appName,
      windowTitle: windowInfo.title,
      screenshotPath,
      taskDescription: null,
      projectId: null,
      manualProjectId: null,
      durationSeconds: null,
      isIdle: false,
      aiAnalysis: null,
    });

    logger.success(`[${timeStr}] Captured: ${windowInfo.appName} - ${windowInfo.title.substring(0, 50)}...`);

    // Analyze with AI (async, don't block)
    analyzeTask(
      windowInfo,
      categorizeApp(windowInfo.appName),
      config.projects,
      screenshotPath
    )
      .then((analysis) => {
        updateEntryAnalysis(
          entryId,
          analysis.taskDescription,
          analysis.suggestedProjectId,
          JSON.stringify(analysis)
        );
        logger.info(`[${timeStr}] AI Analysis: ${analysis.taskDescription} (${analysis.category})`);
      })
      .catch((error) => {
        logger.warning(`[${timeStr}] AI analysis failed: ${error}`);
      });
  } catch (error) {
    logger.error(`[${timeStr}] Capture error: ${error}`);
  }
}

/**
 * Stop the tracker
 */
async function stopTracker(): Promise<void> {
  const config = await loadConfig();

  if (!config.isRunning) {
    logger.warning("Tracker is not running.");
    return;
  }

  await updateConfig({ isRunning: false });
  logger.success("Tracker stopped.");
}

/**
 * Show tracker status
 */
async function showStatus(): Promise<void> {
  const config = await loadConfig();
  initDatabase(config.databasePath);

  const todayCount = getTodayEntryCount();
  const lastEntry = getLastEntry();

  logger.info("WorkTimeTaskLogger Status");
  logger.plain("=".repeat(40));
  logger.info(`Running: ${config.isRunning ? "Yes" : "No"}`);
  logger.info(`Capture Interval: ${config.captureIntervalMinutes} minutes`);
  logger.info(`Entries Today: ${todayCount}`);
  logger.info(`Projects: ${config.projects.length}`);

  if (lastEntry) {
    logger.info(`Last Capture: ${lastEntry.timestamp.toLocaleString()}`);
    logger.info(`Last App: ${lastEntry.appName}`);
  }

  closeDatabase();
}

/**
 * Generate weekly report
 */
async function generateReport(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      week: { type: "string", short: "w" },
      ai: { type: "boolean", short: "a", default: false },
    },
    strict: false,
  });

  const config = await loadConfig();
  initDatabase(config.databasePath);

  let weekStart: Date;
  if (typeof values.week === "string") {
    weekStart = new Date(values.week);
  } else {
    weekStart = getWeekStart();
  }

  logger.info("Generating weekly report...\n");

  const report = await generateWeeklyReport(weekStart);
  logger.plain(formatWeeklyReportText(report));

  if (values.ai) {
    logger.info("\nAI Summary:");
    logger.plain("-".repeat(40));
    const summary = await generateAISummary(report);
    logger.plain(summary);
  }

  closeDatabase();
}

/**
 * Handle export command
 */
async function handleExport(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      format: { type: "string", short: "f", default: "csv" },
      from: { type: "string" },
      to: { type: "string" },
      output: { type: "string", short: "o" },
      type: { type: "string", short: "t", default: "entries" },
    },
    strict: false,
  });

  const config = await loadConfig();
  initDatabase(config.databasePath);

  const format = (typeof values.format === "string" ? values.format : "csv") as ExportFormat;
  const exportType = (typeof values.type === "string" ? values.type : "entries") as "entries" | "report";

  // Default to current week
  const startDate = typeof values.from === "string" ? new Date(values.from) : getWeekStart();
  const endDate = typeof values.to === "string" ? new Date(values.to) : new Date();

  logger.info(`Exporting ${exportType} from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}...`);

  let content: string;
  if (exportType === "report") {
    content = await exportWeeklyReport(startDate, format);
  } else {
    content = await exportTimeEntries({
      format,
      startDate,
      endDate,
    });
  }

  const outputPath =
    typeof values.output === "string"
      ? values.output
      : generateExportFilename(startDate, endDate, format, exportType);

  await saveExport(content, outputPath);
  logger.success(`Exported to: ${outputPath}`);

  closeDatabase();
}

/**
 * Handle projects command
 */
async function handleProjects(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";

  switch (subcommand) {
    case "list": {
      const config = await loadConfig();
      if (config.projects.length === 0) {
        logger.warning("No projects configured.");
        logger.info('Use "projects add" to add a project.');
      } else {
        logger.info("Configured Projects:");
        logger.plain("-".repeat(50));
        for (const project of config.projects) {
          logger.plain(`  ${project.id}`);
          logger.plain(`    Name: ${project.name}`);
          if (project.client) logger.plain(`    Client: ${project.client}`);
          logger.plain(`    Keywords: ${project.keywords.join(", ")}`);
          if (project.hourlyRate) logger.plain(`    Rate: $${project.hourlyRate}/hr`);
          logger.plain("");
        }
      }
      break;
    }

    case "add": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          name: { type: "string", short: "n" },
          client: { type: "string", short: "c" },
          keywords: { type: "string", short: "k" },
          rate: { type: "string", short: "r" },
          color: { type: "string" },
        },
        strict: false,
      });

      if (typeof values.name !== "string") {
        logger.error("Usage: projects add --name <name> [--client <client>] [--keywords <k1,k2>] [--rate <hourly>]");
        return;
      }

      const project: Project = {
        id: generateProjectId(values.name),
        name: values.name,
        keywords: typeof values.keywords === "string" ? values.keywords.split(",").map((k: string) => k.trim()) : [],
        color: typeof values.color === "string" ? values.color : "#3B82F6",
        client: typeof values.client === "string" ? values.client : undefined,
        hourlyRate: typeof values.rate === "string" ? parseFloat(values.rate) : undefined,
      };

      await addProject(project);
      logger.success(`Added project: ${project.name} (${project.id})`);
      break;
    }

    case "remove": {
      const projectId = args[1];
      if (!projectId) {
        logger.error("Usage: projects remove <project-id>");
        return;
      }
      await removeProject(projectId);
      logger.success(`Removed project: ${projectId}`);
      break;
    }

    default:
      logger.error("Unknown projects subcommand. Use: list, add, remove");
  }
}

/**
 * Handle config command
 */
async function handleConfig(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "show";

  switch (subcommand) {
    case "show": {
      const config = await loadConfig();
      logger.info("Current Configuration:");
      logger.plain("-".repeat(40));
      logger.info(`Capture Interval: ${config.captureIntervalMinutes} minutes`);
      logger.info(`Idle Threshold: ${config.idleThresholdSeconds} seconds`);
      logger.info(`Screenshot Directory: ${config.screenshotDir}`);
      logger.info(`Database Path: ${config.databasePath}`);
      logger.info(`Blur Screenshots: ${config.blurScreenshots}`);
      logger.info(`Blur Intensity: ${config.blurIntensity}`);
      logger.info(`Excluded Apps: ${config.excludedApps.join(", ") || "none"}`);
      logger.plain("");
      logger.info("LLM Settings:");
      logger.plain("-".repeat(40));
      logger.info(`Provider: ${config.llmProvider}`);
      logger.info(`Proxy URL: ${config.llmProxyUrl ?? "not set"}`);
      logger.info(`Vision Model: ${config.llmVisionModel}`);
      logger.info(`Text Model: ${config.llmTextModel}`);
      break;
    }

    case "set": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          interval: { type: "string", short: "i" },
          idle: { type: "string" },
          blur: { type: "boolean" },
          "blur-intensity": { type: "string" },
        },
        strict: false,
      });

      const updates: Partial<TrackerConfig> = {};

      if (typeof values.interval === "string") {
        updates.captureIntervalMinutes = parseInt(values.interval, 10);
      }
      if (typeof values.idle === "string") {
        updates.idleThresholdSeconds = parseInt(values.idle, 10);
      }
      if (typeof values.blur === "boolean") {
        updates.blurScreenshots = values.blur;
      }
      if (typeof values["blur-intensity"] === "string") {
        updates.blurIntensity = parseInt(values["blur-intensity"], 10);
      }

      const errors = validateConfig(updates);
      if (errors.length > 0) {
        logger.error("Validation errors:");
        errors.forEach((e) => logger.error(`  - ${e}`));
        return;
      }

      await updateConfig(updates);
      logger.success("Configuration updated.");
      break;
    }

    case "exclude": {
      const appName = args[1];
      if (!appName) {
        logger.error("Usage: config exclude <app-name>");
        return;
      }
      const config = await loadConfig();
      if (!config.excludedApps.includes(appName)) {
        config.excludedApps.push(appName);
        await saveConfig(config);
        logger.success(`Added ${appName} to excluded apps.`);
      } else {
        logger.warning(`${appName} is already excluded.`);
      }
      break;
    }

    case "include": {
      const appName = args[1];
      if (!appName) {
        logger.error("Usage: config include <app-name>");
        return;
      }
      const config = await loadConfig();
      const index = config.excludedApps.indexOf(appName);
      if (index !== -1) {
        config.excludedApps.splice(index, 1);
        await saveConfig(config);
        logger.success(`Removed ${appName} from excluded apps.`);
      } else {
        logger.warning(`${appName} was not excluded.`);
      }
      break;
    }

    case "llm": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          provider: { type: "string", short: "p" },
          url: { type: "string", short: "u" },
          vision: { type: "string", short: "v" },
          text: { type: "string", short: "t" },
        },
        strict: false,
      });

      const updates: Partial<TrackerConfig> = {};

      if (typeof values.provider === "string") {
        if (values.provider === "proxy" || values.provider === "claude-sdk") {
          updates.llmProvider = values.provider;
        } else {
          logger.error("Provider must be 'proxy' or 'claude-sdk'");
          return;
        }
      }
      if (typeof values.url === "string") {
        updates.llmProxyUrl = values.url;
      }
      if (typeof values.vision === "string") {
        updates.llmVisionModel = values.vision;
      }
      if (typeof values.text === "string") {
        updates.llmTextModel = values.text;
      }

      if (Object.keys(updates).length === 0) {
        logger.info("Usage: config llm [options]");
        logger.info("  -p, --provider   LLM provider: proxy or claude-sdk");
        logger.info("  -u, --url        Proxy URL (for proxy mode)");
        logger.info("  -v, --vision     Vision model name");
        logger.info("  -t, --text       Text model name");
        return;
      }

      await updateConfig(updates);
      logger.success("LLM configuration updated.");
      break;
    }

    default:
      logger.error("Unknown config subcommand. Use: show, set, exclude, include, llm");
  }
}

/**
 * Show help message
 */
function showHelp(): void {
  logger.info(`
WorkTimeTaskLogger - AI-powered time tracking agent

Usage: bun run src/index.ts <command> [options]

Commands:
  start              Start the time tracker
  stop               Stop the time tracker
  status             Show tracker status
  report             Generate weekly report
    -w, --week       Week start date (YYYY-MM-DD)
    -a, --ai         Include AI-generated summary
  export             Export time entries
    -f, --format     Export format: csv or json (default: csv)
    --from           Start date (YYYY-MM-DD)
    --to             End date (YYYY-MM-DD)
    -o, --output     Output file path
    -t, --type       Export type: entries or report (default: entries)
  projects           Manage projects
    list             List all projects
    add              Add a new project
      -n, --name     Project name (required)
      -c, --client   Client name
      -k, --keywords Keywords for matching (comma-separated)
      -r, --rate     Hourly rate
    remove <id>      Remove a project
  config             View or update configuration
    show             Show current configuration
    set              Update configuration
      -i, --interval Capture interval in minutes
      --idle         Idle threshold in seconds
      --blur         Enable screenshot blur
      --blur-intensity Blur intensity (0-100)
    exclude <app>    Add app to exclusion list
    include <app>    Remove app from exclusion list
    llm              Configure LLM settings
      -p, --provider LLM provider: proxy or claude-sdk
      -u, --url      Custom proxy URL
      -v, --vision   Vision model name
      -t, --text     Text model name
  help               Show this help message

Environment Variables:
  ANTHROPIC_API_KEY  API key for Claude SDK mode
  LLM_PROXY_API_KEY  API key for custom LLM proxy

Examples:
  bun run src/index.ts start
  bun run src/index.ts projects add --name "Client Project" --client "ACME Corp" --keywords "acme,project-x"
  bun run src/index.ts report --ai
  bun run src/index.ts export --format json --from 2024-01-01 --to 2024-01-07
`);
}

// Run main
main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
