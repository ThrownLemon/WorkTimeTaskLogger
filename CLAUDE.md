# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
bun install                          # Install dependencies
bun run src/index.ts start           # Start the time tracker
bun run src/index.ts stop            # Stop the tracker
bun run src/index.ts status          # Show tracker status
bun run src/index.ts report --ai     # Generate weekly report with AI summary
bun run src/index.ts export --format csv --from 2024-01-01 --to 2024-01-07
bun run typecheck                    # Type check without emitting
bun test                             # Run tests
```

## Bun-Specific Guidelines

- Use `bun:sqlite` for database (not better-sqlite3)
- Use `Bun.file()` for file operations (not node:fs readFile/writeFile)
- Use `Bun.$\`command\`` for shell commands (not execa)
- Bun auto-loads `.env` files - don't use dotenv

## Architecture

This is a CLI time tracking application that captures screenshots, detects active windows, and uses AI to categorize work activities.

### Core Flow
1. **Capture Loop** (`src/index.ts`): Runs at configurable intervals, checks idle state, captures screenshots and window info
2. **AI Analysis** (`src/agent.ts`): Analyzes screenshots/context to determine task and project. Supports two providers:
   - Claude Agent SDK (requires `ANTHROPIC_API_KEY`)
   - Custom OpenAI-compatible proxy (requires `LLM_PROXY_API_KEY`)
3. **Storage** (`src/storage/database.ts`): SQLite via `bun:sqlite` with WAL mode

### macOS Integration
Screenshot and window detection use native macOS commands (not npm packages):
- `screencapture` for screenshots (`src/capture/screenshot.ts`)
- `osascript` (AppleScript) for active window detection (`src/capture/window.ts`)
- `ioreg` for idle time (`src/capture/idle.ts`)

### Configuration
- Config stored in `data/config.json`
- Screenshots stored in `data/screenshots/`
- Database at `data/timetracker.db`
- LLM settings: `llmProvider`, `llmProxyUrl`, `llmVisionModel`, `llmTextModel`

### Key Types (`src/types.ts`)
- `TrackerConfig`: All configuration options
- `TimeEntry`: A captured time entry with screenshot, window info, AI analysis
- `TaskAnalysis`: Result from AI categorization (taskDescription, suggestedProjectId, category, confidence)
- `WorkCategory`: "coding" | "communication" | "research" | "documentation" | "meeting" | "design" | "admin" | "break" | "other"

## Logging

### Logger Utility (`src/utils/logger.ts`)

**IMPORTANT**: Always use the colored logger instead of `console.log/error/warn`. The logger provides consistent, color-coded output throughout the CLI.

**Usage:**

```typescript
import { logger } from "./utils/logger";

logger.success("Operation completed");  // Green with ✓ prefix
logger.error("Failed to process");      // Red with ✗ prefix
logger.warning("Missing configuration"); // Yellow with ⚠ prefix
logger.info("Status information");       // Cyan with ℹ prefix
logger.plain("Regular text");            // White, no prefix
```

**Color Guidelines:**
- **Green (success)**: Successful operations, confirmations, completions
- **Red (error)**: Failures, errors, critical issues
- **Yellow (warning)**: Warnings, skipped operations, idle detection, excluded apps
- **Cyan (info)**: Status messages, section headers, informational output
- **White (plain)**: Regular data output, help text, neutral messages

**Features:**
- Built on `picocolors` (lightweight ANSI color library)
- Optional timestamps: `logger.success("Message", { timestamp: true })`
- Optional prefix control: `logger.error("Message", { prefix: false })`
- Consistent icon prefixes for visual hierarchy

**When to use each level:**
- Use `success()` for: tracker started/stopped, projects added/removed, configuration updated
- Use `error()` for: capture failures, AI analysis errors, invalid commands, missing parameters
- Use `warning()` for: idle detection, excluded apps, missing screenshots, degraded functionality
- Use `info()` for: status displays, report headers, command help, informational messages
- Use `plain()` for: data output, lists, neutral text without semantic meaning
