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
        console.log(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Start the time tracker
 */
async function startTracker(): Promise<void> {
  console.log("Starting WorkTimeTaskLogger...\n");

  const config = await loadConfig();
  await ensureDirectories(config);
  initDatabase(config.databasePath);

  // Check if already running
  if (config.isRunning) {
    console.log("Tracker is already running.");
    return;
  }

  // Mark as running
  await updateConfig({ isRunning: true });

  console.log(`Capture interval: ${config.captureIntervalMinutes} minutes`);
  console.log(`Idle threshold: ${config.idleThresholdSeconds} seconds`);
  console.log(`Screenshot blur: ${config.blurScreenshots ? "enabled" : "disabled"}`);
  console.log(`Projects configured: ${config.projects.length}`);
  console.log("");

  // Set up idle watcher
  const idleWatcher = createIdleWatcher(config, (isIdle, idleSeconds) => {
    if (isIdle) {
      console.log(`[${new Date().toLocaleTimeString()}] User is idle (${formatIdleTime(idleSeconds)})`);
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] User is active again`);
    }
  });

  idleWatcher.start();

  // Capture loop
  const intervalMs = config.captureIntervalMinutes * 60 * 1000;

  console.log("Tracker started. Press Ctrl+C to stop.\n");

  // Initial capture
  await captureAndAnalyze(config);

  // Set up interval
  const timer = setInterval(async () => {
    await captureAndAnalyze(config);
  }, intervalMs);

  // Handle shutdown
  const shutdown = async () => {
    console.log("\nStopping tracker...");
    clearInterval(timer);
    idleWatcher.stop();
    await updateConfig({ isRunning: false });
    closeDatabase();
    console.log("Tracker stopped.");
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
      console.log(`[${timeStr}] Skipping capture - user is idle`);
      return;
    }

    // Get active window
    const windowInfo = await getActiveWindow();
    if (!windowInfo) {
      console.log(`[${timeStr}] No active window detected`);
      return;
    }

    // Check if excluded
    if (shouldExcludeWindow(windowInfo, config)) {
      console.log(`[${timeStr}] Skipping excluded app: ${windowInfo.appName}`);
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
      console.warn(`[${timeStr}] Screenshot capture failed:`, error);
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

    console.log(`[${timeStr}] Captured: ${windowInfo.appName} - ${windowInfo.title.substring(0, 50)}...`);

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
        console.log(`[${timeStr}] AI Analysis: ${analysis.taskDescription} (${analysis.category})`);
      })
      .catch((error) => {
        console.warn(`[${timeStr}] AI analysis failed:`, error);
      });
  } catch (error) {
    console.error(`[${timeStr}] Capture error:`, error);
  }
}

/**
 * Stop the tracker
 */
async function stopTracker(): Promise<void> {
  const config = await loadConfig();

  if (!config.isRunning) {
    console.log("Tracker is not running.");
    return;
  }

  await updateConfig({ isRunning: false });
  console.log("Tracker stopped.");
}

/**
 * Show tracker status
 */
async function showStatus(): Promise<void> {
  const config = await loadConfig();
  initDatabase(config.databasePath);

  const todayCount = getTodayEntryCount();
  const lastEntry = getLastEntry();

  console.log("WorkTimeTaskLogger Status");
  console.log("=".repeat(40));
  console.log(`Running: ${config.isRunning ? "Yes" : "No"}`);
  console.log(`Capture Interval: ${config.captureIntervalMinutes} minutes`);
  console.log(`Entries Today: ${todayCount}`);
  console.log(`Projects: ${config.projects.length}`);

  if (lastEntry) {
    console.log(`Last Capture: ${lastEntry.timestamp.toLocaleString()}`);
    console.log(`Last App: ${lastEntry.appName}`);
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

  console.log("Generating weekly report...\n");

  const report = await generateWeeklyReport(weekStart);
  console.log(formatWeeklyReportText(report));

  if (values.ai) {
    console.log("\nAI Summary:");
    console.log("-".repeat(40));
    const summary = await generateAISummary(report);
    console.log(summary);
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

  console.log(`Exporting ${exportType} from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}...`);

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
  console.log(`Exported to: ${outputPath}`);

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
        console.log("No projects configured.");
        console.log('Use "projects add" to add a project.');
      } else {
        console.log("Configured Projects:");
        console.log("-".repeat(50));
        for (const project of config.projects) {
          console.log(`  ${project.id}`);
          console.log(`    Name: ${project.name}`);
          if (project.client) console.log(`    Client: ${project.client}`);
          console.log(`    Keywords: ${project.keywords.join(", ")}`);
          if (project.hourlyRate) console.log(`    Rate: $${project.hourlyRate}/hr`);
          console.log("");
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
        console.log("Usage: projects add --name <name> [--client <client>] [--keywords <k1,k2>] [--rate <hourly>]");
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
      console.log(`Added project: ${project.name} (${project.id})`);
      break;
    }

    case "remove": {
      const projectId = args[1];
      if (!projectId) {
        console.log("Usage: projects remove <project-id>");
        return;
      }
      await removeProject(projectId);
      console.log(`Removed project: ${projectId}`);
      break;
    }

    default:
      console.log("Unknown projects subcommand. Use: list, add, remove");
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
      console.log("Current Configuration:");
      console.log("-".repeat(40));
      console.log(`Capture Interval: ${config.captureIntervalMinutes} minutes`);
      console.log(`Idle Threshold: ${config.idleThresholdSeconds} seconds`);
      console.log(`Screenshot Directory: ${config.screenshotDir}`);
      console.log(`Database Path: ${config.databasePath}`);
      console.log(`Blur Screenshots: ${config.blurScreenshots}`);
      console.log(`Blur Intensity: ${config.blurIntensity}`);
      console.log(`Excluded Apps: ${config.excludedApps.join(", ") || "none"}`);
      console.log("");
      console.log("LLM Settings:");
      console.log("-".repeat(40));
      console.log(`Provider: ${config.llmProvider}`);
      console.log(`Proxy URL: ${config.llmProxyUrl ?? "not set"}`);
      console.log(`Vision Model: ${config.llmVisionModel}`);
      console.log(`Text Model: ${config.llmTextModel}`);
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
        console.log("Validation errors:");
        errors.forEach((e) => console.log(`  - ${e}`));
        return;
      }

      await updateConfig(updates);
      console.log("Configuration updated.");
      break;
    }

    case "exclude": {
      const appName = args[1];
      if (!appName) {
        console.log("Usage: config exclude <app-name>");
        return;
      }
      const config = await loadConfig();
      if (!config.excludedApps.includes(appName)) {
        config.excludedApps.push(appName);
        await saveConfig(config);
        console.log(`Added ${appName} to excluded apps.`);
      } else {
        console.log(`${appName} is already excluded.`);
      }
      break;
    }

    case "include": {
      const appName = args[1];
      if (!appName) {
        console.log("Usage: config include <app-name>");
        return;
      }
      const config = await loadConfig();
      const index = config.excludedApps.indexOf(appName);
      if (index !== -1) {
        config.excludedApps.splice(index, 1);
        await saveConfig(config);
        console.log(`Removed ${appName} from excluded apps.`);
      } else {
        console.log(`${appName} was not excluded.`);
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
          console.log("Provider must be 'proxy' or 'claude-sdk'");
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
        console.log("Usage: config llm [options]");
        console.log("  -p, --provider   LLM provider: proxy or claude-sdk");
        console.log("  -u, --url        Proxy URL (for proxy mode)");
        console.log("  -v, --vision     Vision model name");
        console.log("  -t, --text       Text model name");
        return;
      }

      await updateConfig(updates);
      console.log("LLM configuration updated.");
      break;
    }

    default:
      console.log("Unknown config subcommand. Use: show, set, exclude, include, llm");
  }
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
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
  console.error("Fatal error:", error);
  process.exit(1);
});
