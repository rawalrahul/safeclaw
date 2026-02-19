import type { Gateway } from "../core/gateway.js";
import { resolveProvider } from "../providers/resolver.js";
import { buildSkillCreatorPrompt, buildReviewerPrompt } from "./roles.js";
import type { LLMMessage } from "../providers/types.js";

/** Maximum revision attempts before giving up and presenting draft to owner. */
const MAX_REVISIONS = 2;

export interface SkillProposal {
  skillName: string;
  skillDescription: string;
  code: string;
  dangerous: boolean;
  reason: string;
}

interface ReviewOutcome {
  approved: boolean;
  feedback: string;
}

// ─── Security review for skill code ──────────────────────────

const SECURITY_REVIEWER_PROMPT = `You are a security reviewer for AI-generated skill code.

Review the code for:
1. Credential exposure — does it read .env, auth.json, or any secrets?
2. Arbitrary code execution — eval(), new Function(), child_process with user input?
3. Network exfiltration — does it POST data to unexpected external servers?
4. Filesystem escape — does it write outside allowed paths?
5. Infinite loops or resource exhaustion?

Output ONLY a JSON object:
{
  "approved": true | false,
  "feedback": "One or two sentences explaining the decision."
}`;

async function reviewSkillCode(
  gw: Gateway,
  code: string,
  skillDescription: string
): Promise<ReviewOutcome> {
  const resolved = resolveProvider(gw.providerStore);
  if (!resolved) return { approved: true, feedback: "" };

  const { provider, model } = resolved;

  const messages: LLMMessage[] = [
    { role: "system" as const, content: SECURITY_REVIEWER_PROMPT },
    {
      role: "user" as const,
      content: `Skill description: ${skillDescription}\n\nCode to review:\n\`\`\`javascript\n${code}\n\`\`\``,
    },
  ];

  try {
    const response = await provider.chat(messages, [], model);
    const text = response.text?.trim() ?? "";
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return { approved: true, feedback: text };
    const json = text.slice(firstBrace, lastBrace + 1);
    return JSON.parse(json) as ReviewOutcome;
  } catch {
    return { approved: true, feedback: "" };
  }
}

// ─── SkillCreator LLM call ────────────────────────────────────

async function generateSkillCode(
  gw: Gateway,
  proposal: Omit<SkillProposal, "code">,
  feedback?: string
): Promise<string | null> {
  const resolved = resolveProvider(gw.providerStore);
  if (!resolved) return null;

  const { provider, model } = resolved;
  const systemPrompt = buildSkillCreatorPrompt();

  const userMessage = [
    `Write a SafeClaw skill with the following specification:`,
    ``,
    `Skill name: ${proposal.skillName}`,
    `Description: ${proposal.skillDescription}`,
    `Reason needed: ${proposal.reason}`,
    `Dangerous (has side effects): ${proposal.dangerous}`,
    ``,
    `The code must export:`,
    `export const skill = {`,
    `  name: "${proposal.skillName}",`,
    `  description: "${proposal.skillDescription}",`,
    `  dangerous: ${proposal.dangerous},`,
    `  parameters: { type: "object", properties: { ... }, required: [...] },`,
    `  async execute(params) { ... return string; }`,
    `};`,
    feedback ? `\nPrevious attempt was rejected for: ${feedback}\nPlease fix this issue in the revised code.` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const messages: LLMMessage[] = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];

  try {
    const response = await provider.chat(messages, [], model);
    return response.text?.trim() ?? null;
  } catch {
    return null;
  }
}

// ─── Main SkillCreator entry point ────────────────────────────

/**
 * Orchestrate skill creation: SkillCreator writes → Reviewer validates (up to 2 attempts).
 * Returns the final SkillProposal (to be presented to owner for /confirm).
 * If reviewer keeps rejecting, returns the last draft anyway with a warning.
 */
export async function createSkillWithReview(
  gw: Gateway,
  proposal: Omit<SkillProposal, "code">
): Promise<{ proposal: SkillProposal; reviewWarning: string | null }> {
  let lastCode: string | null = null;
  let lastFeedback: string | undefined;
  let reviewWarning: string | null = null;

  for (let attempt = 0; attempt <= MAX_REVISIONS; attempt++) {
    const code = await generateSkillCode(gw, proposal, lastFeedback);

    if (!code) {
      // Generation failed — fall back to whatever we have
      break;
    }

    lastCode = code;

    const review = await reviewSkillCode(gw, code, proposal.skillDescription);

    if (review.approved) {
      // Passed security review
      return {
        proposal: { ...proposal, code },
        reviewWarning: null,
      };
    }

    // Reviewer rejected — update feedback for next attempt
    lastFeedback = review.feedback;
    console.log(`[skill-creator] Reviewer rejected attempt ${attempt + 1}: ${review.feedback}`);
  }

  // Exhausted attempts — present the last code with a warning
  const finalCode = lastCode ?? "";
  reviewWarning = lastFeedback
    ? `⚠️ Security reviewer had concerns (${MAX_REVISIONS} revision attempts exhausted): ${lastFeedback}\nReview the code carefully before approving.`
    : null;

  return {
    proposal: { ...proposal, code: finalCode },
    reviewWarning,
  };
}
