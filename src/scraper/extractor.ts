import * as cheerio from "cheerio";
import { ExtractedContent } from "../search/types.js";

const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "10000");
const MAX_CONTENT_LENGTH = parseInt(process.env.MAX_CONTENT_LENGTH || "5000");
const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BLOCKED_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".rar", ".tar", ".gz", ".7z",
  ".mp3", ".mp4", ".avi", ".mkv", ".mov",
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
  ".exe", ".msi", ".dmg", ".apk",
];

function isBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

export async function extractContent(url: string): Promise<ExtractedContent> {
  if (isBlockedUrl(url)) {
    return {
      url,
      title: "",
      content: "",
      links: [],
      success: false,
      error: "Blocked file type",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,az;q=0.8,tr;q=0.7",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        url,
        title: "",
        content: "",
        links: [],
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return {
        url,
        title: "",
        content: "",
        links: [],
        success: false,
        error: `Non-HTML content type: ${contentType}`,
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, aside, .ad, .ads, .advertisement, .sidebar, .menu, .navigation, [role='navigation'], [role='banner'], [role='complementary'], noscript, iframe").remove();

    const title = $("title").first().text().trim() ||
      $("h1").first().text().trim() ||
      "";

    const contentSelectors = [
      "article",
      "[role='main']",
      "main",
      ".post-content",
      ".article-content",
      ".entry-content",
      ".content",
      "#content",
      ".post",
      ".article",
    ];

    let mainContent = "";

    for (const selector of contentSelectors) {
      const el = $(selector).first();
      if (el.length) {
        mainContent = el.text();
        break;
      }
    }

    if (!mainContent) {
      mainContent = $("body").text();
    }

    mainContent = cleanText(mainContent);

    if (mainContent.length > MAX_CONTENT_LENGTH) {
      mainContent = mainContent.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]";
    }

    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      try {
        const absoluteUrl = new URL(href, url).href;
        if (
          absoluteUrl.startsWith("http") &&
          !isBlockedUrl(absoluteUrl) &&
          !absoluteUrl.includes("#") &&
          absoluteUrl !== url
        ) {
          links.push(absoluteUrl);
        }
      } catch {
        // skip invalid URLs
      }
    });

    const uniqueLinks = [...new Set(links)].slice(0, 20);

    return {
      url,
      title,
      content: mainContent,
      links: uniqueLinks,
      success: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      url,
      title: "",
      content: "",
      links: [],
      success: false,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractMultiple(
  urls: string[],
  concurrency: number = 3
): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((url) => extractContent(url))
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({
          url: batch[results.length - (i > 0 ? results.length : 0)] || "unknown",
          title: "",
          content: "",
          links: [],
          success: false,
          error: result.reason?.message || "Promise rejected",
        });
      }
    }
  }

  return results;
}
