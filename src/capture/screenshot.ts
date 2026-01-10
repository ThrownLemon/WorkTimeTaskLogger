/**
 * Screenshot capture module for WorkTimeTaskLogger
 * Uses macOS native screencapture command for Bun compatibility
 */

import { join } from "path";
import type { TrackerConfig } from "../types.ts";
import { logger, formatError } from "../utils/logger.ts";

export interface ScreenshotResult {
  /** Path to the saved screenshot */
  filePath: string;
  /** Timestamp of capture */
  timestamp: Date;
  /** File size in bytes */
  sizeBytes: number;
}

/**
 * Capture a screenshot and save it to the configured directory
 * Uses macOS native screencapture command
 */
export async function captureScreenshot(
  config: TrackerConfig
): Promise<ScreenshotResult> {
  const timestamp = new Date();
  const filename = generateFilename(timestamp);
  const filePath = join(config.screenshotDir, filename);

  // Ensure directory exists
  await Bun.$`mkdir -p ${config.screenshotDir}`.quiet();

  // Use macOS screencapture command
  // -x: no sound, -C: capture cursor, -t jpg: format
  await Bun.$`screencapture -x -C -t jpg ${filePath}`.quiet();

  // Get file stats
  const file = Bun.file(filePath);
  const stats = await file.stat();
  const sizeBytes = stats?.size ?? 0;

  // Apply blur if enabled (using sips - macOS built-in)
  if (config.blurScreenshots && config.blurIntensity > 0) {
    // sips doesn't have blur, so we'll use a resize-down-then-up trick for a blur effect
    const tempPath = filePath.replace(".jpg", "-temp.jpg");
    const scale = Math.max(0.1, 1 - config.blurIntensity / 100);

    try {
      // Scale down then back up to create blur effect
      await Bun.$`sips -Z ${Math.floor(1920 * scale)} ${filePath} --out ${tempPath}`.quiet();
      await Bun.$`sips -Z 1920 ${tempPath} --out ${filePath}`.quiet();
      await Bun.$`rm ${tempPath}`.quiet();
    } catch {
      // If blur fails, just continue with original
    }
  }

  return {
    filePath,
    timestamp,
    sizeBytes,
  };
}

/**
 * Generate a filename for the screenshot
 */
function generateFilename(timestamp: Date): string {
  const dateStr = timestamp.toISOString().replace(/[:.]/g, "-");
  return `screenshot-${dateStr}.jpg`;
}

/**
 * Clean up old screenshots beyond retention period
 */
export async function cleanupOldScreenshots(
  screenshotDir: string,
  retentionDays: number = 30
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  let deletedCount = 0;

  try {
    const glob = new Bun.Glob("*.jpg");
    for await (const file of glob.scan({ cwd: screenshotDir })) {
      const filePath = join(screenshotDir, file);
      const stat = await Bun.file(filePath).stat();

      if (stat && stat.mtime < cutoffDate) {
        await Bun.$`rm ${filePath}`.quiet();
        deletedCount++;
      }
    }
  } catch (error) {
    logger.error(`Error cleaning up old screenshots (dir: ${screenshotDir}, retentionDays: ${retentionDays}): ${formatError(error)}`);
  }

  return deletedCount;
}

/**
 * Get screenshot file path for a given timestamp
 */
export function getScreenshotPath(
  config: TrackerConfig,
  timestamp: Date
): string {
  const filename = generateFilename(timestamp);
  return join(config.screenshotDir, filename);
}

/**
 * Check if a screenshot exists
 */
export async function screenshotExists(filePath: string): Promise<boolean> {
  try {
    return await Bun.file(filePath).exists();
  } catch {
    return false;
  }
}

/**
 * Get total size of screenshots directory in bytes
 */
export async function getScreenshotsDirSize(
  screenshotDir: string
): Promise<number> {
  let totalSize = 0;

  try {
    const glob = new Bun.Glob("*.jpg");
    for await (const file of glob.scan({ cwd: screenshotDir })) {
      const filePath = join(screenshotDir, file);
      const stat = await Bun.file(filePath).stat();
      if (stat) {
        totalSize += stat.size;
      }
    }
  } catch (error) {
    logger.error(`Error calculating screenshots size (dir: ${screenshotDir}): ${formatError(error)}`);
  }

  return totalSize;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
