#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchSearXNG, checkSearXNGAvailable } from "./search/searxng.js";
import { searchDuckDuckGo, checkDuckDuckGoAvailable } from "./search/duckduckgo.js";
import { extractContent, extractMultiple } from "./scraper/extractor.js";
import { deduplicateByUrl, buildResultSummary, formatTimestamp } from "./utils/helpers.js";
import { getCached, setCache, clearCache, getCacheStats, pruneCache } from "./cache/cache.js";
import { detectAzerbaijani, enhanceQueryForAz, prioritizeAzResults } from "./lang/azerbaijani.js";
import { SearchResult, ExtractedContent } from "./search/types.js";
import { searchTapAz, checkTapAzAvailable } from "./search/tapaz.js";
import { searchTurboAz, checkTurboAzAvailable } from "./search/turboaz.js";
import { searchBinaAz, checkBinaAzAvailable } from "./search/binaaz.js";

const server = new McpServer({
  name: "deep-search",
  version: "2.0.0",
});

async function performSearch(
  query: string,
  maxResults: number,
  engines: string[],
  azMode: boolean
): Promise<SearchResult[]> {
  const cacheKey = `${query}|${maxResults}|${engines.join(",")}|${azMode}`;
  const cached = getCached<SearchResult[]>("search", cacheKey);
  if (cached) {
    console.error(`[search] Cache hit for: "${query}"`);
    return cached;
  }

  const queries = azMode ? enhanceQueryForAz(query) : [query];
  const allResults: SearchResult[] = [];
  const errors: string[] = [];
  const searchPromises: Promise<void>[] = [];

  for (const q of queries) {
    if (engines.includes("searxng")) {
      searchPromises.push(
        searchSearXNG(q, maxResults)
          .then((results) => { allResults.push(...results); })
          .catch((err) => { errors.push(`SearXNG[${q}]: ${err.message}`); })
      );
    }

    if (engines.includes("duckduckgo")) {
      searchPromises.push(
        searchDuckDuckGo(q, maxResults)
          .then((results) => { allResults.push(...results); })
          .catch((err) => { errors.push(`DuckDuckGo[${q}]: ${err.message}`); })
      );
    }
  }

  await Promise.allSettled(searchPromises);

  if (allResults.length === 0 && errors.length > 0) {
    throw new Error(`All search engines failed:\n${errors.join("\n")}`);
  }

  let results = deduplicateByUrl(allResults);

  if (azMode) {
    results = prioritizeAzResults(results);
  }

  results = results.slice(0, maxResults);
  setCache("search", cacheKey, results);
  return results;
}

async function fetchAndCache(url: string): Promise<ExtractedContent> {
  const cached = getCached<ExtractedContent>("pages", url);
  if (cached) {
    console.error(`[scraper] Cache hit for: ${url}`);
    return cached;
  }

  const result = await extractContent(url);
  if (result.success) {
    setCache("pages", url, result, 7200000); // 2 hour TTL for pages
  }
  return result;
}

async function fetchMultipleCached(urls: string[], concurrency: number): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = [];
  const uncachedUrls: string[] = [];
  const uncachedIndices: number[] = [];

  for (let i = 0; i < urls.length; i++) {
    const cached = getCached<ExtractedContent>("pages", urls[i]);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedUrls.push(urls[i]);
      uncachedIndices.push(i);
    }
  }

  if (uncachedUrls.length > 0) {
    const fetched = await extractMultiple(uncachedUrls, concurrency);
    for (let j = 0; j < fetched.length; j++) {
      results[uncachedIndices[j]] = fetched[j];
      if (fetched[j].success) {
        setCache("pages", uncachedUrls[j], fetched[j], 7200000);
      }
    }
  }

  return results.filter(Boolean);
}

// ── deep_search: full pipeline with caching + az support ────────────
server.tool(
  "deep_search",
  "Deep web search - searches multiple engines, scrapes pages, extracts and compiles content. Supports Azerbaijani language auto-detection. Results are cached for speed.",
  {
    query: z.string().describe("The search query (supports Azerbaijani)"),
    max_results: z
      .number()
      .min(1)
      .max(20)
      .default(5)
      .describe("Maximum number of results to process (1-20)"),
    search_depth: z
      .number()
      .min(1)
      .max(3)
      .default(1)
      .describe("Search depth: 1=surface, 2=follow top links, 3=deep dive"),
    engines: z
      .array(z.enum(["searxng", "duckduckgo"]))
      .default(["searxng", "duckduckgo"])
      .describe("Search engines to use"),
    azerbaijani_mode: z
      .boolean()
      .default(false)
      .describe("Force Azerbaijani mode (auto-detected if not set)"),
  },
  async ({ query, max_results, search_depth, engines, azerbaijani_mode }) => {
    try {
      const azDetection = detectAzerbaijani(query);
      const azMode = azerbaijani_mode || azDetection.isAzerbaijani;

      console.error(
        `[deep_search] Query: "${query}" | Results: ${max_results} | Depth: ${search_depth} | AZ: ${azMode} (confidence: ${azDetection.confidence.toFixed(2)})`
      );

      const searchResults = await performSearch(query, max_results, engines, azMode);

      if (searchResults.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No search results found for: "${query}"`,
            },
          ],
        };
      }

      console.error(`[deep_search] Found ${searchResults.length} results, extracting content...`);

      const urls = searchResults.map((r) => r.url);
      const extracted = await fetchMultipleCached(urls, 3);

      const contentMap = new Map<string, ExtractedContent>();
      for (const e of extracted) {
        contentMap.set(e.url, e);
      }

      let followUpContents: ExtractedContent[] = [];
      if (search_depth >= 2) {
        const allLinks: string[] = [];
        for (const e of extracted) {
          if (e.success && e.links.length > 0) {
            allLinks.push(...e.links.slice(0, 3));
          }
        }
        const uniqueFollowLinks = [...new Set(allLinks)]
          .filter((link) => !contentMap.has(link))
          .slice(0, max_results);

        if (uniqueFollowLinks.length > 0) {
          console.error(`[deep_search] Depth ${search_depth}: following ${uniqueFollowLinks.length} links...`);
          followUpContents = await fetchMultipleCached(uniqueFollowLinks, 3);
        }
      }

      let deepContents: ExtractedContent[] = [];
      if (search_depth >= 3 && followUpContents.length > 0) {
        const deepLinks: string[] = [];
        for (const e of followUpContents) {
          if (e.success && e.links.length > 0) {
            deepLinks.push(...e.links.slice(0, 2));
          }
        }
        const uniqueDeepLinks = [...new Set(deepLinks)]
          .filter(
            (link) =>
              !contentMap.has(link) &&
              !followUpContents.some((f) => f.url === link)
          )
          .slice(0, 5);

        if (uniqueDeepLinks.length > 0) {
          console.error(`[deep_search] Depth 3: deep diving ${uniqueDeepLinks.length} links...`);
          deepContents = await fetchMultipleCached(uniqueDeepLinks, 2);
        }
      }

      const compiledResults = searchResults.map((sr) => {
        const ext = contentMap.get(sr.url);
        return {
          title: ext?.title || sr.title,
          url: sr.url,
          content: ext?.success
            ? ext.content
            : `[Could not extract content: ${ext?.error || "unknown error"}]\n\nSnippet: ${sr.snippet}`,
        };
      });

      for (const fc of followUpContents) {
        if (fc.success && fc.content) {
          compiledResults.push({
            title: fc.title || "Follow-up result",
            url: fc.url,
            content: fc.content,
          });
        }
      }

      for (const dc of deepContents) {
        if (dc.success && dc.content) {
          compiledResults.push({
            title: dc.title || "Deep dive result",
            url: dc.url,
            content: dc.content,
          });
        }
      }

      const header = azMode
        ? `# Deep Search Results: "${query}" (Azerbaijani mode)\n**Language detected:** Azerbaijani (${Math.round(azDetection.confidence * 100)}% confidence)\n`
        : "";

      const summary = header + buildResultSummary(query, compiledResults);

      return {
        content: [{ type: "text" as const, text: summary }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Deep search failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── quick_search: fast results without scraping ─────────────────────
server.tool(
  "quick_search",
  "Quick web search - returns search result snippets without scraping full pages. Faster than deep_search. Cached.",
  {
    query: z.string().describe("The search query (supports Azerbaijani)"),
    max_results: z
      .number()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of results (1-20)"),
    engines: z
      .array(z.enum(["searxng", "duckduckgo"]))
      .default(["searxng", "duckduckgo"])
      .describe("Search engines to use"),
  },
  async ({ query, max_results, engines }) => {
    try {
      const azDetection = detectAzerbaijani(query);
      const searchResults = await performSearch(query, max_results, engines, azDetection.isAzerbaijani);

      if (searchResults.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results found for: "${query}"`,
            },
          ],
        };
      }

      const lines = [
        `# Search Results: "${query}"`,
        `**${searchResults.length} result(s) found** | ${formatTimestamp()}`,
      ];

      if (azDetection.isAzerbaijani) {
        lines.push(`**Language:** Azerbaijani detected (${Math.round(azDetection.confidence * 100)}%)`);
      }

      lines.push("", "---", "");

      for (let i = 0; i < searchResults.length; i++) {
        const r = searchResults[i];
        lines.push(`### ${i + 1}. ${r.title}`);
        lines.push(`**URL:** ${r.url}`);
        lines.push(`**Engine:** ${r.engine || "unknown"}`);
        lines.push("");
        lines.push(r.snippet || "*No snippet available*");
        lines.push("");
        lines.push("---");
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Search failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── extract_page: scrape a single URL (cached) ─────────────────────
server.tool(
  "extract_page",
  "Extract and return the main text content from a web page URL. Results are cached.",
  {
    url: z.string().url().describe("The URL of the page to extract content from"),
  },
  async ({ url }) => {
    try {
      const result = await fetchAndCache(url);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to extract content from ${url}: ${result.error}`,
            },
          ],
          isError: true,
        };
      }

      const output = [
        `# ${result.title || "Untitled Page"}`,
        `**URL:** ${result.url}`,
        `**Links found:** ${result.links.length}`,
        "",
        "---",
        "",
        result.content,
      ];

      if (result.links.length > 0) {
        output.push("", "---", "", "## Links on this page", "");
        for (const link of result.links.slice(0, 15)) {
          output.push(`- ${link}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: output.join("\n") }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Extraction failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── az_search: Azerbaijani-optimized search ─────────────────────────
server.tool(
  "az_search",
  "Search specifically optimized for Azerbaijani language content. Prioritizes .az domains and Azerbaijani sources. Uses enhanced query expansion.",
  {
    query: z.string().describe("The search query (in Azerbaijani or English)"),
    max_results: z
      .number()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of results (1-20)"),
    scrape_content: z
      .boolean()
      .default(false)
      .describe("Whether to scrape full page content (slower but more detailed)"),
  },
  async ({ query, max_results, scrape_content }) => {
    try {
      const searchResults = await performSearch(query, max_results, ["searxng", "duckduckgo"], true);

      if (searchResults.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Heç bir nəticə tapılmadı: "${query}" (No results found)`,
            },
          ],
        };
      }

      if (scrape_content) {
        const urls = searchResults.map((r) => r.url);
        const extracted = await fetchMultipleCached(urls, 3);

        const compiledResults = searchResults.map((sr, i) => ({
          title: extracted[i]?.title || sr.title,
          url: sr.url,
          content: extracted[i]?.success
            ? extracted[i].content
            : sr.snippet,
        }));

        const summary = `# Azərbaycanca Axtarış: "${query}"\n\n` +
          buildResultSummary(query, compiledResults);

        return {
          content: [{ type: "text" as const, text: summary }],
        };
      }

      const lines = [
        `# Azərbaycanca Axtarış: "${query}"`,
        `**${searchResults.length} nəticə tapıldı** | ${formatTimestamp()}`,
        "",
        "---",
        "",
      ];

      for (let i = 0; i < searchResults.length; i++) {
        const r = searchResults[i];
        lines.push(`### ${i + 1}. ${r.title}`);
        lines.push(`**URL:** ${r.url}`);
        lines.push(`**Mənbə:** ${r.engine || "unknown"}`);
        lines.push("");
        lines.push(r.snippet || "*Məlumat yoxdur*");
        lines.push("");
        lines.push("---");
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Axtarış uğursuz oldu: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── tapaz_search: search tap.az marketplace ─────────────────────────
server.tool(
  "tapaz_search",
  "Search tap.az (Azerbaijan's largest marketplace) for products. Returns listings with prices sorted by price. Use min_price to filter out cheap accessories when searching for actual products (e.g. set min_price=100 for phones).",
  {
    keywords: z.string().describe("Search keywords (e.g. 'SSD 256GB', 'iPhone 13', 'laptop')"),
    category: z
      .enum([
        "all",
        "elektronika",
        "komputer-aksesuarlari",
        "komputer-avadanliqi",
        "telefonlar",
      ])
      .default("all")
      .describe("Product category to search in"),
    min_price: z
      .number()
      .optional()
      .describe("Minimum price in AZN (use this to filter out accessories, e.g. 100 for phones, 20 for SSDs)"),
    max_price: z
      .number()
      .optional()
      .describe("Maximum price in AZN"),
    max_results: z
      .number()
      .min(1)
      .max(50)
      .default(15)
      .describe("Maximum number of listings to return"),
    sort_price: z
      .enum(["asc", "desc"])
      .default("asc")
      .describe("Sort by price: asc=cheapest first, desc=most expensive first"),
  },
  async ({ keywords, category, min_price, max_price, max_results, sort_price }) => {
    try {
      console.error(`[tapaz] Search: "${keywords}" | Category: ${category} | Price: ${min_price ?? "any"}-${max_price ?? "any"} | Sort: ${sort_price}`);

      const cacheKey = `tapaz|${keywords}|${category}|${min_price}|${max_price}|${sort_price}|${max_results}`;
      const cached = getCached<ReturnType<typeof searchTapAz> extends Promise<infer R> ? R : never>("tapaz", cacheKey);

      let listings;
      if (cached) {
        listings = cached;
        console.error(`[tapaz] Cache hit`);
      } else {
        listings = await searchTapAz(keywords, {
          categoryPath: category === "all" ? undefined : `elanlar/elektronika/${category}`,
          maxResults: max_results,
          sortByPrice: sort_price,
          minPrice: min_price,
          maxPrice: max_price,
        });
        setCache("tapaz", cacheKey, listings, 1800000);
      }

      if (listings.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `tap.az-da "${keywords}" üçün heç bir elan tapılmadı. (No listings found on tap.az)`,
            },
          ],
        };
      }

      const priceRange = min_price || max_price
        ? ` | Qiymət: ${min_price ?? "0"}-${max_price ?? "∞"} AZN`
        : "";

      const lines = [
        `# tap.az Axtarış: "${keywords}"`,
        `**${listings.length} elan tapıldı** | Sıralama: ${sort_price === "asc" ? "ən ucuzdan" : "ən bahalıdan"}${priceRange} | ${formatTimestamp()}`,
        "",
      ];

      for (let i = 0; i < listings.length; i++) {
        const l = listings[i];
        lines.push(`### ${i + 1}. ${l.title}`);
        lines.push(`   Qiymət: **${l.price} AZN**`);
        lines.push(`   Ünvan: ${l.region}`);
        lines.push(`   Tarix: ${l.date}`);
        lines.push(`   Link: ${l.url}`);
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `tap.az axtarışı uğursuz oldu: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── turboaz_search: search turbo.az car marketplace ─────────────────
server.tool(
  "turboaz_search",
  "Search turbo.az (Azerbaijan's largest car marketplace) for vehicles. Filter by make, model, year, price. Returns car listings with full details.",
  {
    make: z.string().optional().describe("Car make/brand (e.g. 'Mercedes-Benz', 'BMW', 'Toyota')"),
    model: z.string().optional().describe("Car model (e.g. 'E 220', 'X5', 'Camry')"),
    min_year: z.number().optional().describe("Minimum year"),
    max_year: z.number().optional().describe("Maximum year"),
    min_price: z.number().optional().describe("Minimum price"),
    max_price: z.number().optional().describe("Maximum price"),
    currency: z.enum(["AZN", "USD", "EUR"]).default("AZN").describe("Price currency"),
    sort: z
      .enum(["price_asc", "price_desc", "date_desc"])
      .default("price_asc")
      .describe("Sort order"),
  },
  async ({ make, model, min_year, max_year, min_price, max_price, currency, sort }) => {
    try {
      const cacheKey = `turbo|${make}|${model}|${min_year}|${max_year}|${min_price}|${max_price}|${currency}|${sort}`;
      const cached = getCached<Awaited<ReturnType<typeof searchTurboAz>>>("turboaz", cacheKey);

      let result;
      if (cached) {
        result = cached;
      } else {
        result = await searchTurboAz({
          make, model,
          minYear: min_year, maxYear: max_year,
          minPrice: min_price, maxPrice: max_price,
          currency, sort,
        });
        setCache("turboaz", cacheKey, result, 1800000);
      }

      if (result.cars.length === 0) {
        return {
          content: [{ type: "text" as const, text: `turbo.az-da heç bir avtomobil tapılmadı. (No cars found)` }],
        };
      }

      const lines = [
        `# turbo.az Axtarış`,
        `**${result.cars.length} avtomobil** (${result.totalCount} ümumi) | ${formatTimestamp()}`,
        "",
        "| # | Avtomobil | İl | Qiymət | Yürüş | Ünvan | Link |",
        "|---|-----------|-----|--------|-------|-------|------|",
      ];

      for (let i = 0; i < result.cars.length; i++) {
        const c = result.cars[i];
        lines.push(
          `| ${i + 1} | ${c.name} | ${c.year} | **${c.price.toLocaleString()} ${c.currency}** | ${c.mileage} | ${c.region} | [turbo.az](${c.url}) |`
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [{ type: "text" as const, text: `turbo.az axtarışı uğursuz oldu: ${message}` }],
        isError: true,
      };
    }
  }
);

// ── binaaz_search: search bina.az real estate ───────────────────────
server.tool(
  "binaaz_search",
  "Search bina.az (Azerbaijan's largest real estate marketplace) for properties. Filter by price, area, rooms, location. Returns property listings.",
  {
    type: z.enum(["sale", "rent"]).default("sale").describe("Property type: sale or rent"),
    min_price: z.number().optional().describe("Minimum price (AZN)"),
    max_price: z.number().optional().describe("Maximum price (AZN)"),
    min_area: z.number().optional().describe("Minimum area (sqm)"),
    max_area: z.number().optional().describe("Maximum area (sqm)"),
    rooms: z.number().optional().describe("Number of rooms"),
    has_repair: z.boolean().optional().describe("Has repair/renovation"),
    has_mortgage: z.boolean().optional().describe("Mortgage available"),
    sort: z
      .enum(["PRICE_ASC", "PRICE_DESC", "AREA_ASC", "AREA_DESC"])
      .default("PRICE_ASC")
      .describe("Sort order"),
    limit: z.number().min(1).max(50).default(20).describe("Max results (1-50)"),
  },
  async ({ type, min_price, max_price, min_area, max_area, rooms, has_repair, has_mortgage, sort, limit }) => {
    try {
      const cacheKey = `bina|${type}|${min_price}|${max_price}|${min_area}|${max_area}|${rooms}|${has_repair}|${has_mortgage}|${sort}|${limit}`;
      const cached = getCached<Awaited<ReturnType<typeof searchBinaAz>>>("binaaz", cacheKey);

      let properties;
      if (cached) {
        properties = cached;
      } else {
        properties = await searchBinaAz({
          leased: type === "rent",
          minPrice: min_price, maxPrice: max_price,
          minArea: min_area, maxArea: max_area,
          hasRepair: has_repair, hasMortgage: has_mortgage,
          sort, limit,
        });
        setCache("binaaz", cacheKey, properties, 1800000);
      }

      if (properties.length === 0) {
        return {
          content: [{ type: "text" as const, text: `bina.az-da heç bir əmlak tapılmadı. (No properties found)` }],
        };
      }

      const typeLabel = type === "sale" ? "Satılır" : "Kirayə";
      const lines = [
        `# bina.az: ${typeLabel}`,
        `**${properties.length} əmlak tapıldı** | ${formatTimestamp()}`,
        "",
        "| # | Ünvan | Otaq | Sahə | Qiymət | Təmir | Link |",
        "|---|-------|------|------|--------|-------|------|",
      ];

      for (let i = 0; i < properties.length; i++) {
        const p = properties[i];
        lines.push(
          `| ${i + 1} | ${p.location}, ${p.city} | ${p.rooms ?? "-"} | ${p.area} m² | **${p.price.toLocaleString()} ${p.currency}** | ${p.hasRepair ? "Bəli" : "Xeyr"} | [bina.az](${p.url}) |`
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [{ type: "text" as const, text: `bina.az axtarışı uğursuz oldu: ${message}` }],
        isError: true,
      };
    }
  }
);

// ── check_engines: check which search engines are available ─────────
server.tool(
  "check_engines",
  "Check which search engines (SearXNG, DuckDuckGo) are currently available and reachable. Also shows cache statistics.",
  {},
  async () => {
    const [searxng, duckduckgo, tapaz, turboaz, binaaz] = await Promise.allSettled([
      checkSearXNGAvailable(),
      checkDuckDuckGoAvailable(),
      checkTapAzAvailable(),
      checkTurboAzAvailable(),
      checkBinaAzAvailable(),
    ]);

    const searxngOk = searxng.status === "fulfilled" && searxng.value;
    const ddgOk = duckduckgo.status === "fulfilled" && duckduckgo.value;
    const tapazOk = tapaz.status === "fulfilled" && tapaz.value;
    const turboazOk = turboaz.status === "fulfilled" && turboaz.value;
    const binaazOk = binaaz.status === "fulfilled" && binaaz.value;
    const cacheStats = getCacheStats();

    const lines = [
      "# Deep Search Status",
      "",
      "## Search Engines",
      `- **SearXNG:** ${searxngOk ? "Available" : "Unavailable"} (${process.env.SEARXNG_URL || "http://localhost:8080"})`,
      `- **DuckDuckGo:** ${ddgOk ? "Available" : "Unavailable"}`,
      "",
      "## Azerbaijani Marketplaces",
      `- **tap.az:** ${tapazOk ? "Available" : "Unavailable"} (general marketplace)`,
      `- **turbo.az:** ${turboazOk ? "Available" : "Unavailable"} (cars)`,
      `- **bina.az:** ${binaazOk ? "Available" : "Unavailable"} (real estate)`,
      "",
      "## Cache",
      `- **Total cached items:** ${cacheStats.totalFiles}`,
      `- **Cache size:** ${cacheStats.totalSizeMB} MB`,
    ];

    for (const [cat, count] of Object.entries(cacheStats.categories)) {
      lines.push(`  - ${cat}: ${count} entries`);
    }

    lines.push(
      "",
      "## Features",
      "- Azerbaijani language auto-detection",
      "- File-based result caching",
      "- Multi-depth search (1-3 levels)",
      "- Concurrent page scraping",
      "",
      searxngOk || ddgOk
        ? "Ready to search."
        : "No search engines available! Start SearXNG with `docker compose up -d` or check internet for DuckDuckGo.",
    );

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

// ── manage_cache: cache management tool ─────────────────────────────
server.tool(
  "manage_cache",
  "Manage the search cache - view stats, clear cache, or prune expired entries",
  {
    action: z
      .enum(["stats", "clear", "clear_search", "clear_pages", "prune"])
      .describe("Action: stats=view cache info, clear=clear all, clear_search=clear search cache, clear_pages=clear page cache, prune=remove expired"),
  },
  async ({ action }) => {
    let text = "";

    switch (action) {
      case "stats": {
        const stats = getCacheStats();
        const lines = [
          "# Cache Statistics",
          "",
          `**Total files:** ${stats.totalFiles}`,
          `**Total size:** ${stats.totalSizeMB} MB`,
          "",
        ];
        for (const [cat, count] of Object.entries(stats.categories)) {
          lines.push(`- **${cat}:** ${count} entries`);
        }
        text = lines.join("\n");
        break;
      }
      case "clear": {
        const count = clearCache();
        text = `Cleared ${count} cached entries from all categories.`;
        break;
      }
      case "clear_search": {
        const count = clearCache("search");
        text = `Cleared ${count} cached search results.`;
        break;
      }
      case "clear_pages": {
        const count = clearCache("pages");
        text = `Cleared ${count} cached page extractions.`;
        break;
      }
      case "prune": {
        const count = pruneCache();
        text = `Pruned ${count} expired cache entries.`;
        break;
      }
    }

    return {
      content: [{ type: "text" as const, text }],
    };
  }
);

// ── Start server ────────────────────────────────────────────────────
async function main() {
  pruneCache();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Deep Search MCP v2.0 running on stdio (with caching + Azerbaijani support)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
