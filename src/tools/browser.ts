import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ActionType } from "../core/types.js";

const MAX_CONTENT_LENGTH = 12_000;
const FETCH_TIMEOUT_MS = 15_000;

// ── Playwright singleton ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browser: any = null;
let _playwrightUnavailable = false;

async function getBrowser(): Promise<unknown | null> {
  if (_playwrightUnavailable) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (_browser && (_browser as any).isConnected?.()) return _browser;

  try {
    const pw = await import("playwright");
    _browser = await pw.chromium.launch({ headless: true });
    console.log("[browser] Playwright Chromium launched.");
    return _browser;
  } catch (err) {
    _playwrightUnavailable = true;
    console.warn(
      "[browser] Playwright unavailable — falling back to fetch+Readability.",
      "\n  To enable JS rendering run: npx playwright install chromium",
      "\n  Reason:", (err as Error).message.split("\n")[0]
    );
    return null;
  }
}

/**
 * Close the shared Playwright browser instance.
 * Called on /sleep, /kill, and auto-sleep so the browser process doesn't linger.
 */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (_browser as any).close();
    } catch {
      // already closed
    }
    _browser = null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return clean readable text.
 * Tries Playwright (headless Chromium, full JS) first.
 * Falls back to fetch + @mozilla/readability if Playwright is unavailable.
 * Plain search queries are routed through DuckDuckGo Lite (simpler HTML, more reliable scraping).
 */
export async function fetchUrl(query: string): Promise<{
  action: ActionType;
  description: string;
  result: string;
}> {
  const isUrl = /^https?:\/\//i.test(query);
  const isSearch = !isUrl;

  if (isSearch) {
    // For searches, try DuckDuckGo Lite first (simpler HTML, no JS required)
    const browser = await getBrowser();
    const ddgLiteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    if (browser) {
      const result = await fetchWithPlaywright(browser, ddgLiteUrl);
      if (result) return result;
    }
    return fetchSearchFallback(query, ddgLiteUrl);
  }

  // For explicit URLs, use Playwright if available, otherwise plain fetch
  const browser = await getBrowser();
  if (browser) {
    const result = await fetchWithPlaywright(browser, query);
    if (result) return result;
  }
  return fetchWithFetch(query);
}

// ── Playwright path ───────────────────────────────────────────────────────────

async function fetchWithPlaywright(
  browser: unknown,
  url: string
): Promise<{ action: ActionType; description: string; result: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = browser as any;
  let context: unknown = null;
  let page: unknown = null;

  try {
    context = await b.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      javaScriptEnabled: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page = await (context as any).newPage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any;

    await p.goto(url, { waitUntil: "domcontentloaded", timeout: FETCH_TIMEOUT_MS });

    // Give JS frameworks up to 1.5 s to render
    await p.waitForTimeout(1500);

    const finalUrl: string = p.url();
    const title: string = await p.title();

    // Extract visible text, stripping noise elements
    const content: string = await p.evaluate(() => {
      // Remove script/style/nav/footer noise
      (["script", "style", "noscript", "nav", "footer", "header"] as string[]).forEach((tag) => {
        document.querySelectorAll(tag).forEach((el) => el.remove());
      });
      return (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
    });

    if (!content) return null;

    const truncated =
      content.length > MAX_CONTENT_LENGTH
        ? content.slice(0, MAX_CONTENT_LENGTH) + `\n\n[... truncated at ${MAX_CONTENT_LENGTH} chars]`
        : content;

    const result = title ? `URL: ${finalUrl}\n# ${title}\n\n${truncated}` : `URL: ${finalUrl}\n\n${truncated}`;

    return { action: "browse_web", description: `Fetch ${finalUrl}`, result };
  } catch (err) {
    console.warn("[browser] Playwright fetch failed:", (err as Error).message.split("\n")[0]);
    return null;
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await (page as any)?.close(); } catch { /* ignore */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await (context as any)?.close(); } catch { /* ignore */ }
  }
}

// ── Search fallback (DuckDuckGo Lite parser) ─────────────────────────────────

/**
 * Fetch DuckDuckGo Lite and extract structured search results.
 * DDG Lite returns a simple HTML table — no JS needed, no Readability required.
 */
async function fetchSearchFallback(
  query: string,
  ddgLiteUrl: string
): Promise<{ action: ActionType; description: string; result: string }> {
  let rawHtml: string;

  try {
    const res = await fetch(ddgLiteUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!res.ok) {
      return {
        action: "browse_web",
        description: `Search: ${query}`,
        result: `Search failed: HTTP ${res.status} from DuckDuckGo`,
      };
    }
    rawHtml = await res.text();
  } catch (err) {
    return {
      action: "browse_web",
      description: `Search: ${query}`,
      result: `Search error: ${(err as Error).message}`,
    };
  }

  // DuckDuckGo Lite structure:
  // <a class="result-link" href="...">Title</a>
  // <td class="result-snippet">Snippet text...</td>
  // <span class="link-text">domain.com</span>
  const results: string[] = [`Search results for: ${query}\n`];

  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string }> = [];
  const snippets: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(rawHtml)) !== null) {
    const href = m[1].replace(/&amp;/g, "&");
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    if (href && title) links.push({ url: href, title });
  }
  while ((m = snippetRe.exec(rawHtml)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) snippets.push(text);
  }

  const count = Math.max(links.length, snippets.length);

  if (count === 0) {
    // DDG Lite parse failed — fall back to generic fetch+Readability
    return fetchWithFetch(ddgLiteUrl);
  }

  for (let i = 0; i < Math.min(count, 8); i++) {
    const link = links[i];
    const snippet = snippets[i] ?? "";
    if (link) {
      results.push(`${i + 1}. ${link.title}\n   ${link.url}\n   ${snippet}`);
    } else if (snippet) {
      results.push(`${i + 1}. ${snippet}`);
    }
  }

  const text = results.join("\n\n");
  return {
    action: "browse_web",
    description: `Search: ${query}`,
    result: text.length > MAX_CONTENT_LENGTH ? text.slice(0, MAX_CONTENT_LENGTH) + "\n\n[... truncated]" : text,
  };
}

// ── Fetch fallback ────────────────────────────────────────────────────────────

async function fetchWithFetch(url: string): Promise<{
  action: ActionType;
  description: string;
  result: string;
}> {
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

function extractText(html: string, url: string): string {
  try {
    const { document } = parseHTML(html);
    if (document.baseURI !== url) {
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
    // fall through to regex stripping
  }

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
