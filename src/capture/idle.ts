/**
 * Idle detection module for WorkTimeTaskLogger
 * Uses system commands to detect user inactivity
 */

import type { TrackerConfig } from "../types.ts";

export interface IdleState {
  /** Whether the user is currently idle */
  isIdle: boolean;
  /** Seconds since last user activity */
  idleSeconds: number;
  /** Timestamp of this check */
  checkedAt: Date;
}

/**
 * Get the current idle time in seconds
 * Uses ioreg on macOS to get HIDIdleTime
 */
export async function getIdleTime(): Promise<number> {
  const platform = process.platform;

  if (platform === "darwin") {
    return getIdleTimeMacOS();
  } else if (platform === "linux") {
    return getIdleTimeLinux();
  } else if (platform === "win32") {
    return getIdleTimeWindows();
  }

  // Fallback: assume not idle
  console.warn(`Idle detection not supported on platform: ${platform}`);
  return 0;
}

/**
 * Get idle time on macOS using ioreg
 */
async function getIdleTimeMacOS(): Promise<number> {
  try {
    const result =
      await Bun.$`ioreg -c IOHIDSystem | grep HIDIdleTime`.text();

    // Parse the HIDIdleTime value (in nanoseconds)
    const match = result.match(/HIDIdleTime"\s*=\s*(\d+)/);
    if (match?.[1]) {
      const nanoseconds = parseInt(match[1], 10);
      // Convert nanoseconds to seconds
      return Math.floor(nanoseconds / 1_000_000_000);
    }
  } catch (error) {
    console.error("Error getting macOS idle time:", error);
  }

  return 0;
}

/**
 * Get idle time on Linux using xprintidle
 */
async function getIdleTimeLinux(): Promise<number> {
  try {
    // Try xprintidle first (common on many distros)
    const result = await Bun.$`xprintidle 2>/dev/null`.text();
    const milliseconds = parseInt(result.trim(), 10);
    if (!isNaN(milliseconds)) {
      return Math.floor(milliseconds / 1000);
    }
  } catch {
    // xprintidle not available, try alternative
    try {
      const result =
        await Bun.$`xssstate -i 2>/dev/null || echo 0`.text();
      const milliseconds = parseInt(result.trim(), 10);
      if (!isNaN(milliseconds)) {
        return Math.floor(milliseconds / 1000);
      }
    } catch {
      console.warn(
        "Linux idle detection requires xprintidle or xssstate"
      );
    }
  }

  return 0;
}

/**
 * Get idle time on Windows
 * Note: This requires PowerShell
 */
async function getIdleTimeWindows(): Promise<number> {
  try {
    const psScript = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class IdleTime {
        [DllImport("user32.dll")]
        public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
        public struct LASTINPUTINFO {
          public uint cbSize;
          public uint dwTime;
        }
      }
"@
      $lastInput = New-Object IdleTime+LASTINPUTINFO
      $lastInput.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lastInput)
      [IdleTime]::GetLastInputInfo([ref]$lastInput) | Out-Null
      $idleTime = ([Environment]::TickCount - $lastInput.dwTime) / 1000
      [Math]::Floor($idleTime)
    `;

    const result =
      await Bun.$`powershell -Command ${psScript}`.text();
    const seconds = parseInt(result.trim(), 10);
    if (!isNaN(seconds)) {
      return seconds;
    }
  } catch (error) {
    console.error("Error getting Windows idle time:", error);
  }

  return 0;
}

/**
 * Check if the user is currently idle based on config threshold
 */
export async function checkIdleState(
  config: TrackerConfig
): Promise<IdleState> {
  const idleSeconds = await getIdleTime();
  const isIdle = idleSeconds >= config.idleThresholdSeconds;

  return {
    isIdle,
    idleSeconds,
    checkedAt: new Date(),
  };
}

/**
 * Create an idle watcher that calls back when idle state changes
 */
export function createIdleWatcher(
  config: TrackerConfig,
  onIdleChange: (isIdle: boolean, idleSeconds: number) => void
): { start: () => void; stop: () => void } {
  let timer: Timer | null = null;
  let wasIdle = false;

  const checkInterval = Math.min(config.idleThresholdSeconds * 1000, 30000); // Check at most every 30s

  const check = async () => {
    const state = await checkIdleState(config);

    if (state.isIdle !== wasIdle) {
      wasIdle = state.isIdle;
      onIdleChange(state.isIdle, state.idleSeconds);
    }
  };

  return {
    start: () => {
      if (!timer) {
        check(); // Initial check
        timer = setInterval(check, checkInterval);
      }
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/**
 * Format idle time for display
 */
export function formatIdleTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}
