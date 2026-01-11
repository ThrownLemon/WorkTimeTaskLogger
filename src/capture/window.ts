/**
 * Active window detection module for WorkTimeTaskLogger
 * Uses macOS native AppleScript for Bun compatibility
 */

import type { WindowInfo, TrackerConfig } from "../types.ts";
import { logger, formatError } from "../utils/logger.ts";

/**
 * Simple rate limiter to prevent log spam
 */
const rateLimitedWarnings = new Map<string, number>();

function warnOnceOrRateLimit(
  message: string,
  stableKey: string,
  windowMs: number = 60000
): void {
  const now = Date.now();
  const lastWarned = rateLimitedWarnings.get(stableKey);

  if (!lastWarned || now - lastWarned > windowMs) {
    logger.warning(message);
    rateLimitedWarnings.set(stableKey, now);
  }
}

/**
 * Get information about the currently active window using AppleScript
 */
export async function getActiveWindow(): Promise<WindowInfo | null> {
  try {
    // AppleScript to get frontmost app and window info
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set bundleId to bundle identifier of frontApp
        set pid to unix id of frontApp
        try
          set windowTitle to name of first window of frontApp
        on error
          set windowTitle to ""
        end try
        return appName & "|||" & windowTitle & "|||" & bundleId & "|||" & pid
      end tell
    `;

    const result = await Bun.$`osascript -e ${script}`.text();
    const parts = result.trim().split("|||");

    if (parts.length < 4) {
      return null;
    }

    return {
      appName: parts[0] ?? "",
      title: parts[1] ?? "",
      bundleId: parts[2] ?? null,
      pid: parseInt(parts[3] ?? "0", 10),
    };
  } catch (error) {
    warnOnceOrRateLimit(
      `Error getting active window: ${formatError(error)}`,
      "getActiveWindow"
    );
    return null;
  }
}

/**
 * Check if the current window/app should be excluded from tracking
 */
export function shouldExcludeWindow(
  windowInfo: WindowInfo,
  config: TrackerConfig
): boolean {
  const appNameLower = windowInfo.appName.toLowerCase();

  // Check against excluded apps list
  for (const excludedApp of config.excludedApps) {
    if (appNameLower.includes(excludedApp.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize window title to remove sensitive information
 */
export function sanitizeWindowTitle(title: string): string {
  // Remove common sensitive patterns
  const patterns = [
    // Email addresses
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    // Credit card numbers (basic pattern)
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    // Phone numbers
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    // URLs with possible auth tokens
    /https?:\/\/[^\s]*token=[^\s&]*/gi,
    /https?:\/\/[^\s]*key=[^\s&]*/gi,
    /https?:\/\/[^\s]*secret=[^\s&]*/gi,
  ];

  let sanitized = title;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  return sanitized;
}

/**
 * Extract meaningful context from window title
 */
export function extractWindowContext(windowInfo: WindowInfo): {
  app: string;
  context: string;
  isFileOpen: boolean;
  fileName: string | null;
} {
  const title = windowInfo.title;
  const app = windowInfo.appName;

  // Common patterns for file paths in window titles
  const filePatterns = [
    // VS Code: "filename.ts — project - Visual Studio Code"
    /^(.+?)\s[—-]\s/,
    // Sublime: "filename.ts • project"
    /^(.+?)\s[•·]\s/,
    // Generic: "filename.ext"
    /^([^/\\]+\.[a-z]{1,10})(?:\s|$)/i,
  ];

  let fileName: string | null = null;
  for (const pattern of filePatterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      fileName = match[1];
      break;
    }
  }

  return {
    app,
    context: sanitizeWindowTitle(title),
    isFileOpen: fileName !== null,
    fileName,
  };
}

/**
 * Categorize app by type
 */
export function categorizeApp(
  appName: string
): "browser" | "editor" | "terminal" | "communication" | "design" | "other" {
  const name = appName.toLowerCase();

  // Browsers
  if (
    name.includes("chrome") ||
    name.includes("firefox") ||
    name.includes("safari") ||
    name.includes("edge") ||
    name.includes("brave") ||
    name.includes("arc")
  ) {
    return "browser";
  }

  // Code editors
  if (
    name.includes("code") ||
    name.includes("sublime") ||
    name.includes("atom") ||
    name.includes("vim") ||
    name.includes("nvim") ||
    name.includes("emacs") ||
    name.includes("xcode") ||
    name.includes("intellij") ||
    name.includes("webstorm") ||
    name.includes("pycharm") ||
    name.includes("cursor")
  ) {
    return "editor";
  }

  // Terminals
  if (
    name.includes("terminal") ||
    name.includes("iterm") ||
    name.includes("warp") ||
    name.includes("kitty") ||
    name.includes("alacritty") ||
    name.includes("hyper")
  ) {
    return "terminal";
  }

  // Communication
  if (
    name.includes("slack") ||
    name.includes("discord") ||
    name.includes("teams") ||
    name.includes("zoom") ||
    name.includes("meet") ||
    name.includes("mail") ||
    name.includes("outlook") ||
    name.includes("messages")
  ) {
    return "communication";
  }

  // Design
  if (
    name.includes("figma") ||
    name.includes("sketch") ||
    name.includes("photoshop") ||
    name.includes("illustrator") ||
    name.includes("affinity") ||
    name.includes("canva")
  ) {
    return "design";
  }

  return "other";
}

/**
 * Get a list of common apps that are often excluded
 */
export function getCommonExcludedApps(): string[] {
  return [
    "1Password",
    "Keychain Access",
    "System Preferences",
    "System Settings",
    "Finder", // Often not relevant for work tracking
    "Preview", // Usually just viewing images/PDFs
    "Screenshot",
    "Screen Sharing",
    "FaceTime",
    "Photo Booth",
    "QuickTime Player",
  ];
}
