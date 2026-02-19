import type { Gateway } from "../core/gateway.js";
import { resolveProvider } from "../providers/resolver.js";
import { getResourceLimits } from "../infra/probe.js";
import { getRoleConfig, buildManagerPrompt } from "./roles.js";
import { runSubAgent } from "./sub-agent.js";
import type { LLMMessage } from "../providers/types.js";

/** Threshold for considering a message "complex" enough for multi-agent routing. */
const COMPLEX_KEYWORDS = [
  "build", "create", "generate", "make", "develop", "implement",
  "analyse", "analyze", "debug and fix", "refactor", "redesign",
  "plan", "design", "architect",
];

/** Minimum word count / sentence count to trigger multi-agent path. */
const MIN_SENTENCES_FOR_ORCHESTRATION = 3;

interface SubTask {
  id: string;
  description: string;
  role: "worker" | "reviewer" | "skill_creator";
  dependsOn: string[];
}

interface TaskPlan {
  strategy: "direct" | "sequential" | "parallel";
  subtasks: SubTask[];
  needsReview: boolean;
}

// ─── Complexity heuristic ─────────────────────────────────────

/**
 * Decide whether to use the multi-agent orchestrated path.
 * Returns false for simple messages so they bypass manager overhead.
 */
export function isComplexTask(text: string): boolean {
  const trimmed = text.trim().toLowerCase();

  // Sentence count heuristic
  const sentenceCount = (trimmed.match(/[.!?]+/g) ?? []).length;
  if (sentenceCount >= MIN_SENTENCES_FOR_ORCHESTRATION) return true;

  // Keyword heuristic
  for (const kw of COMPLEX_KEYWORDS) {
    if (trimmed.includes(kw)) return true;
  }

  return false;
}

// ─── Manager LLM call ────────────────────────────────────────

async function callManager(gw: Gateway, userText: string): Promise<TaskPlan | null> {
  const resolved = resolveProvider(gw.providerStore);
  if (!resolved) return null;

  const { provider, model } = resolved;
  const limits = gw.infraContext ? getResourceLimits(gw.infraContext) : null;
  const managerPrompt = buildManagerPrompt(gw.infraContext, limits);

  const messages: LLMMessage[] = [
    { role: "system" as const, content: managerPrompt },
    { role: "user" as const, content: userText },
  ];

  try {
    const response = await provider.chat(messages, [], model);
    const text = response.text?.trim() ?? "";

    // Parse the JSON plan from the manager response
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;

    const json = text.slice(firstBrace, lastBrace + 1);
    const plan = JSON.parse(json) as TaskPlan;

    // Validate
    if (!plan.strategy || !Array.isArray(plan.subtasks)) return null;
    return plan;
  } catch {
    return null;
  }
}

// ─── Reviewer call ────────────────────────────────────────────

interface ReviewResult {
  approved: boolean;
  feedback: string;
}

async function callReviewer(gw: Gateway, originalTask: string, result: string): Promise<ReviewResult> {
  const resolved = resolveProvider(gw.providerStore);
  if (!resolved) return { approved: true, feedback: "" };

  const { provider, model } = resolved;
  const config = getRoleConfig("reviewer", { originalTask });

  const messages: LLMMessage[] = [
    { role: "system" as const, content: config.systemPrompt },
    { role: "user" as const, content: `Result to review:\n\n${result}` },
  ];

  try {
    const response = await provider.chat(messages, [], model);
    const text = response.text?.trim() ?? "";

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return { approved: true, feedback: text };

    const json = text.slice(firstBrace, lastBrace + 1);
    const review = JSON.parse(json) as ReviewResult;
    return review;
  } catch {
    return { approved: true, feedback: "" };
  }
}

// ─── Main orchestrated runner ─────────────────────────────────

/**
 * Run the multi-agent orchestrated path for complex tasks.
 *
 * Flow:
 *   Manager → TaskPlan
 *   Execute subtasks (parallel or sequential)
 *   Optional Reviewer pass
 *   Return assembled response
 */
export async function runOrchestrated(gw: Gateway, userText: string): Promise<string> {
  const limits = gw.infraContext ? getResourceLimits(gw.infraContext) : null;
  const maxWorkers = limits?.maxParallelWorkers ?? 2;

  // Step 1: Manager decomposes the task
  const plan = await callManager(gw, userText);

  if (!plan || plan.strategy === "direct" || plan.subtasks.length === 0) {
    // Manager says: handle directly — fall back to single-agent path
    const { runAgent } = await import("../agent/runner.js");
    return runAgent(gw, userText);
  }

  const headerLines = [
    `📋 Task decomposed into ${plan.subtasks.length} subtask(s) [${plan.strategy}]:`,
    ...plan.subtasks.map((t, i) => `  ${i + 1}. ${t.description}`),
    "",
  ];

  // Step 2: Execute subtasks
  const results = new Map<string, string>(); // id → result
  const allPendingActions: string[] = [];

  if (plan.strategy === "parallel") {
    // Run all independent subtasks concurrently, respecting maxWorkers
    const chunks = chunkArray(plan.subtasks, maxWorkers);
    for (const chunk of chunks) {
      const settled = await Promise.allSettled(
        chunk.map(async (task) => {
          const taskResult = await executeSubTask(gw, task, results);
          return { id: task.id, result: taskResult };
        })
      );
      for (const r of settled) {
        if (r.status === "fulfilled") {
          results.set(r.value.id, r.value.result.text);
          allPendingActions.push(...r.value.result.pendingActions);
        }
      }
    }
  } else {
    // Sequential: each task may depend on previous results
    for (const task of plan.subtasks) {
      const taskResult = await executeSubTask(gw, task, results);
      results.set(task.id, taskResult.text);
      allPendingActions.push(...taskResult.pendingActions);
    }
  }

  // Assemble results
  const combinedResult = plan.subtasks
    .map((t) => results.get(t.id) ?? "(no result)")
    .join("\n\n---\n\n");

  // Step 3: Optional reviewer pass
  let reviewNote = "";
  if (plan.needsReview) {
    const review = await callReviewer(gw, userText, combinedResult);
    if (!review.approved && review.feedback) {
      reviewNote = `\n\n⚠️ Reviewer feedback: ${review.feedback}`;
    }
  }

  // Build final response
  const parts = [headerLines.join("\n"), combinedResult];

  if (allPendingActions.length > 0) {
    parts.push(
      `\n⚠️ The following actions require /confirm before they can execute:\n` +
      allPendingActions.map((a) => `  • ${a}`).join("\n")
    );
  }

  if (reviewNote) parts.push(reviewNote);

  return parts.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────

async function executeSubTask(
  gw: Gateway,
  task: SubTask,
  priorResults: Map<string, string>
): Promise<{ text: string; pendingActions: string[] }> {
  // Inject results from dependencies into the task description
  let augmentedDescription = task.description;
  if (task.dependsOn.length > 0) {
    const depContext = task.dependsOn
      .map((depId) => {
        const depResult = priorResults.get(depId);
        return depResult ? `Previous result (step ${depId}):\n${depResult}` : null;
      })
      .filter(Boolean)
      .join("\n\n");

    if (depContext) {
      augmentedDescription = `${task.description}\n\nContext from previous steps:\n${depContext}`;
    }
  }

  const config = getRoleConfig(task.role === "skill_creator" ? "skill_creator" : "worker", {
    taskDescription: augmentedDescription,
  });

  return runSubAgent(gw, task.role === "skill_creator" ? "skill_creator" : "worker", config.systemPrompt, augmentedDescription);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
