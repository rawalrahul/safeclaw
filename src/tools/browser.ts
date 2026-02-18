import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ActionType } from "../core/types.js";

const MAX_CONTENT_LENGTH = 12_000;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch a URL and return clean readable text.
 * Uses @mozilla/readability (same as Firefox Reader Mode) for articles.
 * Falls back to regex HTML stripping for non-article pages.
 * Plain search queries are routed through DuckDuckGo HTML (no API key needed).
 */
export async function fetchUrl(query: string): Promise<{
  action: ActionType;
  description: string;
  result: string;
}> {
  const url = /^https?:\/\//i.test(query)
    ? query
    : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  let rawHtml: string;
  let finalUrl = url;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    finalUrl = res.url || url;

    if (!res.ok) {
      return {
        action: "browse_web",
        description: `Fetch ${url}`,
        result: `HTTP ${res.status} ${res.statusText} — ${url}`,
      };
    }

    rawHtml = await res.text();
  } catch (err) {
    return {
      action: "browse_web",
      description: `Fetch ${url}`,
      result: `Network error: ${(err as Error).message}`,
    };
  }

  const plain = extractText(rawHtml, finalUrl);
  const truncated =
    plain.length > MAX_CONTENT_LENGTH
      ? plain.slice(0, MAX_CONTENT_LENGTH) + `\n\n[... truncated at ${MAX_CONTENT_LENGTH} chars]`
      : plain;

  return {
    action: "browse_web",
    description: `Fetch ${finalUrl}`,
    result: `URL: ${finalUrl}\n\n${truncated}`,
  };
}

/**
 * Extract readable text from raw HTML.
 * Tries Readability first (Firefox Reader Mode algorithm) — great for articles/news.
 * Falls back to regex stripping for pages Readability can't handle (search results, SPAs, etc).
 */
function extractText(html: string, url: string): string {
  // Try Readability for article pages
  try {
    const { document } = parseHTML(html);
    // Readability needs the document URL to resolve relative links
    if (document.baseURI !== url) {
      // linkedom doesn't set baseURI from URL arg, but Readability uses it
      // to handle relative links — set it via a <base> element
      const base = document.createElement("base");
      base.setAttribute("href", url);
      document.head?.prepend(base);
    }
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (article?.textContent?.trim()) {
      const parts: string[] = [];
      if (article.title) parts.push(`# ${article.title}`);
      if (article.byline) parts.push(`By: ${article.byline}`);
      if (article.publishedTime) parts.push(`Published: ${article.publishedTime}`);
      parts.push("");
      parts.push(article.textContent.replace(/\n{3,}/g, "\n\n").trim());
      return parts.join("\n");
    }
  } catch {
    // Readability failed — fall through to regex stripping
  }

  // Fallback: strip HTML tags
  return html
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
}
