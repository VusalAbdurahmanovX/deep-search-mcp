import { SearchResult } from "./types.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "10000");

interface SearXNGResponse {
  results: {
    title: string;
    url: string;
    content: string;
    engine: string;
    score?: number;
  }[];
  number_of_results: number;
}

export async function checkSearXNGAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${SEARXNG_URL}/healthz`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

export async function searchSearXNG(
  query: string,
  maxResults: number = 10,
  language: string = "all"
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    categories: "general",
    language,
    pageno: "1",
    safesearch: "0",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${SEARXNG_URL}/search?${params}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as SearXNGResponse;

    return (data.results || []).slice(0, maxResults).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.content || "",
      engine: r.engine || "searxng",
    }));
  } finally {
    clearTimeout(timeout);
  }
}
