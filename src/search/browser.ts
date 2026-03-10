import { chromium, Browser, Page } from "playwright";
import { SearchResult } from "./types.js";

let _browser: Browser | null = null;
let _browserLaunchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  if (_browserLaunchPromise) return _browserLaunchPromise;

  _browserLaunchPromise = chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
    ],
  });

  _browser = await _browserLaunchPromise;
  _browserLaunchPromise = null;
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser?.isConnected()) {
    await _browser.close();
    _browser = null;
  }
}

export async function checkBrowserAvailable(): Promise<boolean> {
  try {
    const browser = await getBrowser();
    return browser.isConnected();
  } catch {
    return false;
  }
}

export async function searchGoogle(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  const page = await context.newPage();
  const results: SearchResult[] = [];

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

    await page.waitForSelector("#search", { timeout: 8000 }).catch(() => {});

    const searchResults = await page.$$eval(
      "div.g, div[data-sokoban-container]",
      (elements, max) => {
        return elements.slice(0, max).map((el) => {
          const titleEl = el.querySelector("h3");
          const linkEl = el.querySelector("a[href]");
          const snippetEl =
            el.querySelector("[data-sncf], .VwiC3b, .IsZvec, .s3v9rd") ||
            el.querySelector("span:not(h3 span)");

          const href = linkEl?.getAttribute("href") || "";
          const isValid =
            href.startsWith("http") &&
            !href.includes("google.com/search") &&
            !href.includes("accounts.google");

          return {
            title: titleEl?.textContent?.trim() || "",
            url: isValid ? href : "",
            snippet: snippetEl?.textContent?.trim() || "",
            engine: "google-browser",
          };
        });
      },
      maxResults
    );

    for (const r of searchResults) {
      if (r.url && r.title) {
        results.push(r);
      }
    }
  } catch (err) {
    console.error(`[browser] Google search error: ${err instanceof Error ? err.message : err}`);
  } finally {
    await context.close();
  }

  return results.slice(0, maxResults);
}

export async function searchBing(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  const page = await context.newPage();
  const results: SearchResult[] = [];

  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

    await page.waitForSelector("#b_results", { timeout: 8000 }).catch(() => {});

    const searchResults = await page.$$eval(
      "li.b_algo",
      (elements, max) => {
        return elements.slice(0, max).map((el) => {
          const titleEl = el.querySelector("h2 a");
          const snippetEl = el.querySelector(".b_caption p, .b_lineclamp2");

          return {
            title: titleEl?.textContent?.trim() || "",
            url: titleEl?.getAttribute("href") || "",
            snippet: snippetEl?.textContent?.trim() || "",
            engine: "bing-browser",
          };
        });
      },
      maxResults
    );

    for (const r of searchResults) {
      if (r.url && r.title && r.url.startsWith("http")) {
        results.push(r);
      }
    }
  } catch (err) {
    console.error(`[browser] Bing search error: ${err instanceof Error ? err.message : err}`);
  } finally {
    await context.close();
  }

  return results.slice(0, maxResults);
}

export async function browserSearch(
  query: string,
  maxResults: number = 10,
  engines: ("google" | "bing")[] = ["google", "bing"]
): Promise<SearchResult[]> {
  const promises: Promise<SearchResult[]>[] = [];

  if (engines.includes("google")) {
    promises.push(
      searchGoogle(query, maxResults).catch((err) => {
        console.error(`[browser] Google failed: ${err.message}`);
        return [] as SearchResult[];
      })
    );
  }

  if (engines.includes("bing")) {
    promises.push(
      searchBing(query, maxResults).catch((err) => {
        console.error(`[browser] Bing failed: ${err.message}`);
        return [] as SearchResult[];
      })
    );
  }

  const settled = await Promise.allSettled(promises);
  const allResults: SearchResult[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      allResults.push(...result.value);
    }
  }

  const seen = new Set<string>();
  return allResults.filter((r) => {
    const key = r.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxResults);
}
