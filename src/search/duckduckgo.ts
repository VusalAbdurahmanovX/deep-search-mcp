import * as cheerio from "cheerio";
import { SearchResult } from "./types.js";

const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "10000");
const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractRealUrl(rawHref: string): string | null {
  if (!rawHref) return null;

  if (rawHref.startsWith("http") && !rawHref.includes("duckduckgo.com")) {
    return rawHref;
  }

  const prefixed = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
  try {
    const parsed = new URL(prefixed);

    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      const decoded = decodeURIComponent(uddg);
      if (decoded.includes("duckduckgo.com/y.js")) {
        const inner = new URL(decoded);
        const u3 = inner.searchParams.get("u3");
        if (u3) {
          const u3Decoded = decodeURIComponent(u3);
          const bingMatch = u3Decoded.match(/[&?]u=([^&]+)/);
          if (bingMatch) {
            return decodeURIComponent(atob(bingMatch[1]));
          }
          return u3Decoded;
        }
      }
      return decoded;
    }
  } catch {
    // fall through
  }

  return null;
}

export async function checkDuckDuckGoAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch("https://lite.duckduckgo.com/lite/", {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

export async function searchDuckDuckGo(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    const resultLinks = $("a.result-link");
    const resultSnippets = $("td.result-snippet");

    resultLinks.each((i, el) => {
      if (results.length >= maxResults) return false;

      const title = $(el).text().trim();
      const rawHref = $(el).attr("href") || "";
      const snippet = resultSnippets.eq(i)?.text()?.trim() || "";

      if (!title || title === "more info") return;

      const realUrl = extractRealUrl(rawHref);
      if (!realUrl || realUrl.includes("duckduckgo.com")) return;

      results.push({ title, url: realUrl, snippet, engine: "duckduckgo" });
    });

    return results;
  } finally {
    clearTimeout(timeout);
  }
}
