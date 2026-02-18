/**
 * Drop-in replacement for fetch() that automatically retries on 429 responses.
 *
 * Retry delay priority:
 *   1. Retry-After header (standard, used by OpenAI and Anthropic)
 *   2. "retry in Xs" text in the response body (Gemini's format)
 *   3. Exponential backoff: 2^attempt * 2 seconds (2s → 4s → 8s)
 *
 * The body is only consumed on non-final attempts so the caller can still
 * read it on the last attempt (to surface the real error message).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);

    // Not rate-limited — return immediately
    if (res.status !== 429) return res;

    // Final attempt exhausted — return the 429 response as-is so the caller
    // can read the body and surface a proper error message
    if (attempt === maxRetries) return res;

    // ── Determine how long to wait ──────────────────────────────
    let delayMs = Math.pow(2, attempt) * 2_000; // default: 2s, 4s, 8s

    const retryAfter = res.headers.get("Retry-After");
    if (retryAfter) {
      const secs = parseFloat(retryAfter);
      if (!isNaN(secs) && secs > 0) delayMs = secs * 1_000;
    } else {
      // Gemini puts the delay in the body: "Please retry in 35.9s."
      try {
        const body = await res.text();
        const match = body.match(/retry in ([\d.]+)s/i);
        if (match) delayMs = parseFloat(match[1]) * 1_000;
      } catch {
        // ignore — fall back to exponential backoff
      }
    }

    // Cap at 90 seconds so we don't stall forever on hard quota limits
    delayMs = Math.min(delayMs, 90_000);

    console.warn(
      `[provider] Rate limited (429). Waiting ${Math.round(delayMs / 1_000)}s before retry ` +
        `(attempt ${attempt + 1}/${maxRetries})...`
    );

    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  // Unreachable — TypeScript requires a return
  return fetch(url, init);
}
