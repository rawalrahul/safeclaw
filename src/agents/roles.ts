import type { InfraContext } from "../core/types.js";
import type { ResourceLimits } from "../infra/probe.js";

export type AgentRole = "manager" | "worker" | "reviewer" | "skill_creator";

export interface RoleConfig {
  role: AgentRole;
  systemPrompt: string;
  /** If true, this agent has full tool access. */
  hasToolAccess: boolean;
  /** If true, this agent can only read files (not write/delete). */
  readOnlyTools: boolean;
}

// ─── Manager role ─────────────────────────────────────────────

export function buildManagerPrompt(infra: InfraContext | null, limits: ResourceLimits | null): string {
  const infraSection = infra
    ? [
        `System resources:`,
        `  CPU: ${infra.cpuCores} cores, load: ${infra.loadAvg.toFixed(2)}`,
        `  RAM: ${infra.ramFreeGB.toFixed(1)} GB free / ${infra.ramTotalGB.toFixed(1)} GB total`,
        infra.gpus.length > 0
          ? `  GPU: ${infra.gpus.map((g) => `${g.name} (${(g.vramFreeMB / 1024).toFixed(1)}GB free VRAM)`).join(", ")}`
          : `  GPU: none`,
        infra.ollamaModels.length > 0
          ? `  Ollama models: ${infra.ollamaModels.map((m) => `${m.name} (${m.sizeGB.toFixed(1)}GB)`).join(", ")}`
          : `  Ollama: no models`,
        limits
          ? `  Max parallel workers: ${limits.maxParallelWorkers}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "System resources: unknown (probe not yet complete)";

  return `You are the Manager agent in SafeClaw's multi-agent orchestration system.

Your job is to analyse an incoming task and decide how to route it. You must output ONLY a JSON object — no markdown, no explanation, just the raw JSON.

${infraSection}

Output schema:
{
  "strategy": "direct" | "sequential" | "parallel",
  "subtasks": [
    { "id": "1", "description": "...", "role": "worker", "dependsOn": [] },
    { "id": "2", "description": "...", "role": "worker", "dependsOn": ["1"] }
  ],
  "needsReview": true | false
}

Rules:
- "direct": task is simple — output empty subtasks array, needsReview: false.
- "sequential": subtasks must run one after another (each depends on previous).
- "parallel": subtasks are independent and can run concurrently.
- Set needsReview: true for tasks that produce creative output, code, or decisions.
- Keep subtasks focused: each worker should do ONE thing.
- Do not exceed ${limits?.maxParallelWorkers ?? 2} parallel workers.
- Respect resource limits when deciding parallelism.`;
}

// ─── Worker role ──────────────────────────────────────────────

export function buildWorkerPrompt(taskDescription: string): string {
  return `You are a Worker agent. Your sole job is to execute this specific task:

${taskDescription}

Rules:
- Use the tools available to you to complete the task.
- Be thorough but concise — output only what is needed for the next agent.
- Do not ask clarifying questions — make reasonable assumptions.
- If a tool fails, try an alternative approach. Do not give up after one failure.
- Return your result as plain text.`;
}

// ─── Reviewer role ────────────────────────────────────────────

export function buildReviewerPrompt(originalTask: string): string {
  return `You are the Reviewer agent in SafeClaw's multi-agent system. You validate results.

Original task: ${originalTask}

Your job:
1. Check that the result actually addresses the original task.
2. Check for obvious errors, omissions, or quality issues.
3. Output a JSON object:
{
  "approved": true | false,
  "feedback": "..."
}

Rules:
- Be concise in feedback — one or two sentences.
- Only reject if there is a clear, specific problem.
- Do NOT re-do the work — only evaluate it.
- Output ONLY the JSON object.`;
}

// ─── Role configs ──────────────────────────────────────────────

export function getRoleConfig(role: AgentRole, context?: {
  infra?: InfraContext | null;
  limits?: ResourceLimits | null;
  taskDescription?: string;
  originalTask?: string;
}): RoleConfig {
  switch (role) {
    case "manager":
      return {
        role,
        systemPrompt: buildManagerPrompt(context?.infra ?? null, context?.limits ?? null),
        hasToolAccess: false,
        readOnlyTools: false,
      };

    case "worker":
      return {
        role,
        systemPrompt: buildWorkerPrompt(context?.taskDescription ?? "Complete the assigned task."),
        hasToolAccess: true,
        readOnlyTools: false,
      };

    case "reviewer":
      return {
        role,
        systemPrompt: buildReviewerPrompt(context?.originalTask ?? ""),
        hasToolAccess: false,
        readOnlyTools: true,
      };

    case "skill_creator":
      return {
        role,
        systemPrompt: buildSkillCreatorPrompt(),
        hasToolAccess: true,
        readOnlyTools: false,
      };
  }
}

// ─── SkillCreator role (also used by Task 5) ─────────────────

export function buildSkillCreatorPrompt(): string {
  return `You are the SkillCreator agent in SafeClaw's multi-agent system.

Your job is to write complete, correct, safe Node.js ES module code for a new skill.

Rules:
- Output ONLY the JavaScript/TypeScript ES module code. No explanation, no markdown fences.
- The module must export a default async function: export default async function(params) { ... }
- The function must return a string result.
- Use only Node.js built-ins and packages that are already installed in SafeClaw (grammy, dotenv, uuid, zod, @modelcontextprotocol/sdk).
- Do NOT use require() — use import() if dynamic imports are needed.
- Do NOT access .env files, auth.json, or any credentials directly.
- Keep the code as simple and self-contained as possible.
- Handle errors gracefully — catch and return error messages rather than throwing.`;
}
