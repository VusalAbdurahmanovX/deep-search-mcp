import { chromium, Browser } from "playwright";
import { ExtractedContent } from "../search/types.js";

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
    ],
  });

  _browser = await _browserLaunchPromise;
  _browserLaunchPromise = null;
  return _browser;
}

const SKIP_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".mp3", ".mp4", ".avi", ".mkv", ".mov",
  ".exe", ".msi", ".dmg",
];

export async function browserExtractContent(url: string): Promise<ExtractedContent> {
  const lowerUrl = url.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (lowerUrl.endsWith(ext)) {
      return {
        url,
        title: "",
        content: "",
        links: [],
        success: false,
        error: `Skipped binary/non-HTML file: ${ext}`,
      };
    }
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });

    const title = await page.title();

    const content = await page.evaluate(() => {
      const selectors = [
        "article",
        "main",
        '[role="main"]',
        ".post-content",
        ".article-content",
        ".entry-content",
        "#content",
        ".content",
      ];

      let mainEl: Element | null = null;
      for (const sel of selectors) {
        mainEl = document.querySelector(sel);
        if (mainEl) break;
      }

      if (!mainEl) mainEl = document.body;

      const tagsToRemove = ["script", "style", "nav", "header", "footer", "iframe", "noscript", "aside"];
      const clone = mainEl.cloneNode(true) as Element;
      for (const tag of tagsToRemove) {
        clone.querySelectorAll(tag).forEach((el) => el.remove());
      }
      clone.querySelectorAll('[aria-hidden="true"], .hidden, .sr-only').forEach((el) => el.remove());

      return (clone.textContent || "")
        .replace(/\s+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 8000);
    });

    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll("a[href]");
      const hrefs: string[] = [];
      anchors.forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        if (
          href.startsWith("http") &&
          !href.includes("javascript:") &&
          !href.includes("#") &&
          !href.includes("mailto:")
        ) {
          hrefs.push(href);
        }
      });
      return [...new Set(hrefs)].slice(0, 30);
    });

    return { url, title, content, links, success: true };
  } catch (err) {
    return {
      url,
      title: "",
      content: "",
      links: [],
      success: false,
      error: err instanceof Error ? err.message : "Browser extraction failed",
    };
  } finally {
    await context.close();
  }
}

export async function browserExtractMultiple(
  urls: string[],
  concurrency: number = 2
): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = new Array(urls.length);
  const queue = urls.map((url, i) => ({ url, index: i }));

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      results[item.index] = await browserExtractContent(item.url);
    }
  });

  await Promise.all(workers);
  return results;
}
