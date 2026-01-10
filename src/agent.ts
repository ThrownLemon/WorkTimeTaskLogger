/**
 * Claude Agent for task analysis in WorkTimeTaskLogger
 * Supports both Claude Agent SDK and custom OpenAI-compatible LLM proxy
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "./config/settings.ts";
import type {
  TaskAnalysis,
  WorkCategory,
  Project,
  WindowInfo,
  TrackerConfig,
} from "./types.ts";

const TASK_ANALYSIS_PROMPT = `You are a productivity analyst helping categorize work activities.

Analyze the provided context about what the user is working on and provide:
1. A brief task description (1-2 sentences)
2. The most likely project/client this relates to (if any match the configured projects)
3. A confidence score (0-1)
4. The work category

Available projects:
{projects}

Context about current activity:
- Application: {appName}
- Window Title: {windowTitle}
- App Category: {appCategory}

Respond in JSON format only, no other text:
{
  "taskDescription": "string",
  "suggestedProjectId": "string or null",
  "confidence": number,
  "category": "coding|communication|research|documentation|meeting|design|admin|break|other",
  "notes": "string or null"
}`;

const VISION_ANALYSIS_PROMPT = `You are a productivity analyst. Analyze this screenshot to understand what work is being done.

Context:
- Application: {appName}
- Window Title: {windowTitle}

Available projects to match against:
{projects}

Based on the screenshot and context, respond in JSON format only:
{
  "taskDescription": "brief description of the work activity",
  "suggestedProjectId": "matching project id or null",
  "confidence": 0.0-1.0,
  "category": "coding|communication|research|documentation|meeting|design|admin|break|other",
  "notes": "any additional observations"
}`;

/**
 * Call the custom LLM proxy (OpenAI-compatible)
 */
async function callLLMProxy(
  config: TrackerConfig,
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>,
  useVisionModel: boolean = false
): Promise<string> {
  const apiKey = process.env.LLM_PROXY_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_PROXY_API_KEY environment variable is required");
  }

  if (!config.llmProxyUrl) {
    throw new Error("LLM proxy URL is not configured");
  }

  const model = useVisionModel ? config.llmVisionModel : config.llmTextModel;
  const url = `${config.llmProxyUrl}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM proxy error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Convert image file to base64 data URL
 */
async function imageToBase64(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Analyze a time entry using the custom LLM proxy with vision
 */
async function analyzeTaskWithProxy(
  config: TrackerConfig,
  windowInfo: WindowInfo,
  appCategory: string,
  projects: Project[],
  screenshotPath?: string | null
): Promise<TaskAnalysis> {
  const projectList =
    projects.length > 0
      ? projects
          .map((p) => `- ${p.name} (ID: ${p.id}): keywords: ${p.keywords.join(", ")}`)
          .join("\n")
      : "No projects configured";

  // If we have a screenshot, use vision
  if (screenshotPath) {
    try {
      const imageBase64 = await imageToBase64(screenshotPath);

      const prompt = VISION_ANALYSIS_PROMPT
        .replace("{appName}", windowInfo.appName)
        .replace("{windowTitle}", windowInfo.title)
        .replace("{projects}", projectList);

      const result = await callLLMProxy(
        config,
        [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
        true // use vision model
      );

      return parseAnalysisResult(result, windowInfo, appCategory);
    } catch (error) {
      console.warn("Vision analysis failed, falling back to text:", error);
      // Fall through to text-only analysis
    }
  }

  // Text-only analysis
  const prompt = TASK_ANALYSIS_PROMPT
    .replace("{projects}", projectList)
    .replace("{appName}", windowInfo.appName)
    .replace("{windowTitle}", windowInfo.title)
    .replace("{appCategory}", appCategory);

  const result = await callLLMProxy(
    config,
    [{ role: "user", content: prompt }],
    false
  );

  return parseAnalysisResult(result, windowInfo, appCategory);
}

/**
 * Analyze a time entry using Claude Agent SDK
 */
async function analyzeTaskWithClaudeSDK(
  windowInfo: WindowInfo,
  appCategory: string,
  projects: Project[],
  screenshotPath?: string | null
): Promise<TaskAnalysis> {
  const projectList =
    projects.length > 0
      ? projects
          .map((p) => `- ${p.name} (ID: ${p.id}): keywords: ${p.keywords.join(", ")}`)
          .join("\n")
      : "No projects configured";

  const screenshotContext = screenshotPath
    ? `- Screenshot available at: ${screenshotPath} (analyze if helpful)`
    : "- No screenshot available";

  const prompt = TASK_ANALYSIS_PROMPT
    .replace("{projects}", projectList)
    .replace("{appName}", windowInfo.appName)
    .replace("{windowTitle}", windowInfo.title)
    .replace("{appCategory}", appCategory)
    + `\n${screenshotContext}`;

  try {
    let result = "";

    for await (const message of query({
      prompt,
      options: {
        allowedTools: screenshotPath ? ["Read"] : [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if ("result" in message && message.type === "result") {
        result = message.result;
      }
    }

    return parseAnalysisResult(result, windowInfo, appCategory);
  } catch (error) {
    console.error("Error analyzing task with Claude SDK:", error);
    return createFallbackAnalysis(windowInfo, appCategory);
  }
}

/**
 * Parse the analysis result JSON
 */
function parseAnalysisResult(
  result: string,
  windowInfo: WindowInfo,
  appCategory: string
): TaskAnalysis {
  try {
    // Try to find JSON in the response
    const jsonMatch = result.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        taskDescription?: string;
        suggestedProjectId?: string | null;
        confidence?: number;
        category?: string;
        notes?: string | null;
      };
      return {
        taskDescription: parsed.taskDescription ?? "Unknown activity",
        suggestedProjectId: parsed.suggestedProjectId ?? null,
        confidence: parsed.confidence ?? 0.5,
        category: validateCategory(parsed.category),
        notes: parsed.notes ?? null,
      };
    }
  } catch (error) {
    console.warn("Failed to parse analysis result:", error);
  }

  return createFallbackAnalysis(windowInfo, appCategory);
}

/**
 * Analyze a time entry to determine task and project
 */
export async function analyzeTask(
  windowInfo: WindowInfo,
  appCategory: string,
  projects: Project[],
  screenshotPath?: string | null
): Promise<TaskAnalysis> {
  const config = await loadConfig();

  if (config.llmProvider === "proxy" && config.llmProxyUrl) {
    try {
      return await analyzeTaskWithProxy(
        config,
        windowInfo,
        appCategory,
        projects,
        screenshotPath
      );
    } catch (error) {
      console.error("Proxy analysis failed:", error);
      return createFallbackAnalysis(windowInfo, appCategory);
    }
  } else {
    return analyzeTaskWithClaudeSDK(
      windowInfo,
      appCategory,
      projects,
      screenshotPath
    );
  }
}

/**
 * Validate and normalize the work category
 */
function validateCategory(category?: string): WorkCategory {
  const validCategories: WorkCategory[] = [
    "coding",
    "communication",
    "research",
    "documentation",
    "meeting",
    "design",
    "admin",
    "break",
    "other",
  ];

  if (category && validCategories.includes(category as WorkCategory)) {
    return category as WorkCategory;
  }

  return "other";
}

/**
 * Create a fallback analysis when AI is unavailable
 */
function createFallbackAnalysis(
  windowInfo: WindowInfo,
  appCategory: string
): TaskAnalysis {
  const categoryMap: Record<string, WorkCategory> = {
    browser: "research",
    editor: "coding",
    terminal: "coding",
    communication: "communication",
    design: "design",
    other: "other",
  };

  return {
    taskDescription: `Working in ${windowInfo.appName}`,
    suggestedProjectId: null,
    confidence: 0.3,
    category: categoryMap[appCategory] ?? "other",
    notes: "Fallback analysis - AI unavailable",
  };
}

/**
 * Batch analyze multiple entries (more efficient for catch-up)
 */
export async function batchAnalyzeTasks(
  entries: Array<{
    id: number;
    windowInfo: WindowInfo;
    appCategory: string;
    screenshotPath?: string | null;
  }>,
  projects: Project[]
): Promise<Map<number, TaskAnalysis>> {
  const results = new Map<number, TaskAnalysis>();

  // Process in parallel with a concurrency limit
  const concurrencyLimit = 3;
  const chunks: typeof entries[] = [];

  for (let i = 0; i < entries.length; i += concurrencyLimit) {
    chunks.push(entries.slice(i, i + concurrencyLimit));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (entry) => {
      const analysis = await analyzeTask(
        entry.windowInfo,
        entry.appCategory,
        projects,
        entry.screenshotPath
      );
      results.set(entry.id, analysis);
    });

    await Promise.all(promises);

    // Small delay between chunks to avoid rate limits
    if (chunk !== chunks[chunks.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Generate a weekly summary using the configured LLM
 */
export async function generateWeeklySummary(
  weekData: {
    totalHours: number;
    projectBreakdown: Array<{ name: string; hours: number }>;
    topActivities: string[];
  }
): Promise<string> {
  const prompt = `Generate a brief, professional weekly timesheet summary based on this data:

Total Hours: ${weekData.totalHours.toFixed(1)}

Project Breakdown:
${weekData.projectBreakdown.map((p) => `- ${p.name}: ${p.hours.toFixed(1)} hours`).join("\n")}

Top Activities:
${weekData.topActivities.map((a) => `- ${a}`).join("\n")}

Provide a 2-3 sentence summary suitable for a timesheet submission.`;

  const config = await loadConfig();

  try {
    if (config.llmProvider === "proxy" && config.llmProxyUrl) {
      return await callLLMProxy(
        config,
        [{ role: "user", content: prompt }],
        false
      );
    } else {
      // Use Claude SDK
      let result = "";

      for await (const message of query({
        prompt,
        options: {
          allowedTools: [],
          maxTurns: 1,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        },
      })) {
        if ("result" in message && message.type === "result") {
          result = message.result;
        }
      }

      return result || "Weekly summary generation failed.";
    }
  } catch (error) {
    console.error("Error generating weekly summary:", error);
    return `Worked ${weekData.totalHours.toFixed(1)} hours across ${weekData.projectBreakdown.length} projects.`;
  }
}
