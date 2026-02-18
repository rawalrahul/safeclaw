import type { ActionType } from "../core/types.js";

const MAX_CONTENT_LENGTH = 8000;

/**
 * Fetch a URL and return readable plain text (HTML tags stripped).
 * Used by the browser tool when the LLM calls browse_web.
 */
export async function fetchUrl(query: string): Promise<{
  action: ActionType;
  description: string;
  result: string;
}> {
  // Determine if the query looks like a URL or a search query
  let url: string;
  if (/^https?:\/\//i.test(query)) {
    url = query;
  } else {
    // Fall back to a DuckDuckGo HTML search (no API key needed)
    url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  }

  let text: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SafeClaw/1.0)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        action: "browse_web",
        description: `Fetch ${url}`,
        result: `HTTP ${res.status} ${res.statusText} — ${url}`,
      };
    }
    text = await res.text();
  } catch (err) {
    return {
      action: "browse_web",
      description: `Fetch ${url}`,
      result: `Network error: ${(err as Error).message}`,
    };
  }

  // Strip HTML tags and collapse whitespace for readability
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();

  const truncated = plain.length > MAX_CONTENT_LENGTH
    ? plain.slice(0, MAX_CONTENT_LENGTH) + `\n\n[... truncated at ${MAX_CONTENT_LENGTH} chars]`
    : plain;

  return {
    action: "browse_web",
    description: `Fetch ${url}`,
    result: `URL: ${url}\n\n${truncated}`,
  };
}

/** @deprecated stub kept for compatibility during transition */
export function simulateBrowser(query: string): {
  action: ActionType;
  description: string;
  result: string;
} {
  return {
    action: "browse_web",
    description: `Browse web: "${query}"`,
    result: `[browser tool is initialising — use fetchUrl() instead]`,
  };
}
