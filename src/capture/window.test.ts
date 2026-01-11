/**
 * Tests for window detection utilities
 */

import { describe, test, expect } from "bun:test";
import {
  shouldExcludeWindow,
  sanitizeWindowTitle,
  extractWindowContext,
  categorizeApp,
  getCommonExcludedApps,
} from "./window.ts";
import type { WindowInfo, TrackerConfig } from "../types.ts";

// Helper to create a mock WindowInfo
function createWindowInfo(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    appName: "Test App",
    title: "Test Window Title",
    bundleId: "com.test.app",
    pid: 12345,
    ...overrides,
  };
}

// Helper to create a mock TrackerConfig
function createConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    captureIntervalMinutes: 5,
    idleThresholdSeconds: 300,
    screenshotDir: "/tmp/screenshots",
    databasePath: "/tmp/test.db",
    blurScreenshots: false,
    blurIntensity: 20,
    excludedApps: [],
    projects: [],
    isRunning: false,
    llmProvider: "proxy",
    llmProxyUrl: null,
    llmVisionModel: "test-model",
    llmTextModel: "test-model",
    ...overrides,
  };
}

describe("shouldExcludeWindow", () => {
  test("returns false when excludedApps is empty", () => {
    const windowInfo = createWindowInfo({ appName: "VS Code" });
    const config = createConfig({ excludedApps: [] });

    expect(shouldExcludeWindow(windowInfo, config)).toBe(false);
  });

  test("returns true for exact match in excludedApps", () => {
    const windowInfo = createWindowInfo({ appName: "1Password" });
    const config = createConfig({ excludedApps: ["1Password"] });

    expect(shouldExcludeWindow(windowInfo, config)).toBe(true);
  });

  test("returns true for case-insensitive partial match", () => {
    const windowInfo = createWindowInfo({ appName: "Google Chrome" });
    const config = createConfig({ excludedApps: ["chrome"] });

    expect(shouldExcludeWindow(windowInfo, config)).toBe(true);
  });

  test("returns false when app not in excludedApps", () => {
    const windowInfo = createWindowInfo({ appName: "VS Code" });
    const config = createConfig({ excludedApps: ["Safari", "Firefox"] });

    expect(shouldExcludeWindow(windowInfo, config)).toBe(false);
  });

  test("handles multiple excluded apps", () => {
    const config = createConfig({
      excludedApps: ["1Password", "Keychain", "System Preferences"],
    });

    expect(
      shouldExcludeWindow(createWindowInfo({ appName: "1Password 8" }), config)
    ).toBe(true);
    expect(
      shouldExcludeWindow(createWindowInfo({ appName: "Keychain Access" }), config)
    ).toBe(true);
    expect(
      shouldExcludeWindow(createWindowInfo({ appName: "VS Code" }), config)
    ).toBe(false);
  });
});

describe("sanitizeWindowTitle", () => {
  test("removes email addresses", () => {
    const title = "Email from user@example.com - Subject";
    const result = sanitizeWindowTitle(title);
    expect(result).not.toContain("user@example.com");
    expect(result).toContain("[REDACTED]");
  });

  test("removes credit card numbers", () => {
    const title = "Payment: 1234-5678-9012-3456";
    const result = sanitizeWindowTitle(title);
    expect(result).not.toContain("1234-5678-9012-3456");
    expect(result).toContain("[REDACTED]");
  });

  test("removes phone numbers", () => {
    const title = "Call from 555-123-4567";
    const result = sanitizeWindowTitle(title);
    expect(result).not.toContain("555-123-4567");
    expect(result).toContain("[REDACTED]");
  });

  test("removes URLs with tokens", () => {
    const title = "https://api.example.com?token=abc123secret";
    const result = sanitizeWindowTitle(title);
    expect(result).not.toContain("abc123secret");
    expect(result).toContain("[REDACTED]");
  });

  test("removes URLs with keys", () => {
    const title = "https://api.example.com?key=mysecretkey123";
    const result = sanitizeWindowTitle(title);
    expect(result).not.toContain("mysecretkey123");
    expect(result).toContain("[REDACTED]");
  });

  test("removes URLs with secrets", () => {
    const title = "https://api.example.com?secret=topsecret";
    const result = sanitizeWindowTitle(title);
    expect(result).not.toContain("topsecret");
    expect(result).toContain("[REDACTED]");
  });

  test("preserves safe content", () => {
    const title = "index.ts — MyProject - Visual Studio Code";
    const result = sanitizeWindowTitle(title);
    expect(result).toBe(title);
  });

  test("handles multiple sensitive items", () => {
    const title = "Email to user@test.com about 555-123-4567";
    const result = sanitizeWindowTitle(title);
    expect(result).not.toContain("user@test.com");
    expect(result).not.toContain("555-123-4567");
    expect(result.match(/\[REDACTED\]/g)?.length).toBe(2);
  });
});

describe("extractWindowContext", () => {
  test("extracts filename from VS Code style title", () => {
    const windowInfo = createWindowInfo({
      appName: "Code",
      title: "index.ts — MyProject - Visual Studio Code",
    });

    const result = extractWindowContext(windowInfo);
    expect(result.app).toBe("Code");
    expect(result.fileName).toBe("index.ts");
    expect(result.isFileOpen).toBe(true);
  });

  test("extracts filename from Sublime style title", () => {
    const windowInfo = createWindowInfo({
      appName: "Sublime Text",
      title: "app.tsx • project-name",
    });

    const result = extractWindowContext(windowInfo);
    expect(result.fileName).toBe("app.tsx");
    expect(result.isFileOpen).toBe(true);
  });

  test("extracts simple filename", () => {
    const windowInfo = createWindowInfo({
      appName: "TextEdit",
      title: "document.txt",
    });

    const result = extractWindowContext(windowInfo);
    expect(result.fileName).toBe("document.txt");
    expect(result.isFileOpen).toBe(true);
  });

  test("returns null fileName for non-file titles", () => {
    const windowInfo = createWindowInfo({
      appName: "Safari",
      title: "Google Search Results",
    });

    const result = extractWindowContext(windowInfo);
    expect(result.fileName).toBe(null);
    expect(result.isFileOpen).toBe(false);
  });

  test("sanitizes window title in context", () => {
    const windowInfo = createWindowInfo({
      appName: "Mail",
      title: "Email from user@secret.com",
    });

    const result = extractWindowContext(windowInfo);
    expect(result.context).toContain("[REDACTED]");
  });
});

describe("categorizeApp", () => {
  describe("browsers", () => {
    test.each([
      "Google Chrome",
      "Firefox",
      "Safari",
      "Microsoft Edge",
      "Brave Browser",
      "Arc",
    ])("categorizes %s as browser", (appName) => {
      expect(categorizeApp(appName)).toBe("browser");
    });
  });

  describe("editors", () => {
    test.each([
      "Visual Studio Code",
      "Code",
      "Sublime Text",
      "Atom",
      "Vim",
      "NeoVim",
      "Emacs",
      "Xcode",
      "IntelliJ IDEA",
      "WebStorm",
      "PyCharm",
      "Cursor",
    ])("categorizes %s as editor", (appName) => {
      expect(categorizeApp(appName)).toBe("editor");
    });
  });

  describe("terminals", () => {
    test.each([
      "Terminal",
      "iTerm2",
      "iTerm",
      "Warp",
      "kitty",
      "Alacritty",
      "Hyper",
    ])("categorizes %s as terminal", (appName) => {
      expect(categorizeApp(appName)).toBe("terminal");
    });
  });

  describe("communication", () => {
    test.each([
      "Slack",
      "Discord",
      "Microsoft Teams",
      "Zoom",
      "Google Meet",
      "Mail",
      "Outlook",
      "Messages",
    ])("categorizes %s as communication", (appName) => {
      expect(categorizeApp(appName)).toBe("communication");
    });
  });

  describe("design", () => {
    test.each([
      "Figma",
      "Sketch",
      "Adobe Photoshop",
      "Adobe Illustrator",
      "Affinity Designer",
      "Canva",
    ])("categorizes %s as design", (appName) => {
      expect(categorizeApp(appName)).toBe("design");
    });
  });

  describe("other", () => {
    test.each(["Finder", "Preview", "Calculator", "Notes", "System Preferences"])(
      "categorizes %s as other",
      (appName) => {
        expect(categorizeApp(appName)).toBe("other");
      }
    );
  });
});

describe("getCommonExcludedApps", () => {
  test("returns an array of app names", () => {
    const apps = getCommonExcludedApps();
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);
  });

  test("includes common security apps", () => {
    const apps = getCommonExcludedApps();
    expect(apps).toContain("1Password");
    expect(apps).toContain("Keychain Access");
  });

  test("includes system apps", () => {
    const apps = getCommonExcludedApps();
    expect(apps.some((app) => app.includes("System"))).toBe(true);
  });
});
