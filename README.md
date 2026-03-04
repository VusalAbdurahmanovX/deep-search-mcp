# Deep Search MCP Server

Self-hosted MCP (Model Context Protocol) server for deep web search with built-in Azerbaijani marketplace integrations. Zero paid APIs, fully free, works locally.

## Features

- **Deep Web Search** — Multi-engine search with page scraping and recursive link following (depth 1-3)
- **Azerbaijani Language Support** — Auto-detects Azerbaijani text, prioritizes .az domains, expands queries
- **tap.az Integration** — Search Azerbaijan's largest general marketplace via GraphQL API
- **turbo.az Integration** — Search the largest car marketplace via REST API (44,000+ listings)
- **bina.az Integration** — Search the largest real estate marketplace via GraphQL API (79,000+ listings)
- **File-based Caching** — Search results and scraped pages cached locally for speed
- **DuckDuckGo Search** — Free web search without any API keys
- **SearXNG Support** — Optional self-hosted metasearch (aggregates Google, Bing, DuckDuckGo)

## MCP Tools

| Tool | Description |
|------|-------------|
| `deep_search` | Full pipeline — search, scrape pages, follow links (depth 1-3), auto-detects Azerbaijani |
| `quick_search` | Fast snippet-only web search |
| `extract_page` | Scrape and extract content from any URL |
| `az_search` | Azerbaijani-optimized web search |
| `tapaz_search` | Search tap.az marketplace with price filtering |
| `turboaz_search` | Search turbo.az cars (filter by make, model, year, price) |
| `binaaz_search` | Search bina.az real estate (filter by price, area, rooms, type) |
| `check_engines` | Check status of all search engines and marketplaces |
| `manage_cache` | Cache management (stats, clear, prune expired) |

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/VusalAbdurahmanovX/deep-search-mcp.git
cd deep-search-mcp
npm install
npm run build
```

### Add to Cursor

Add to your `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "node",
      "args": ["/path/to/deep-search-mcp/dist/index.js"],
      "env": {
        "SEARXNG_URL": "http://localhost:8080",
        "REQUEST_TIMEOUT": "10000"
      }
    }
  }
}
```

Restart Cursor and the tools will be available.

### Optional: SearXNG (for Google/Bing aggregation)

```bash
docker compose up -d
```

This starts SearXNG on `http://localhost:8080` with Google, Bing, DuckDuckGo, and Wikipedia.

## Usage Examples

### Search the web

```
Use deep_search to find "machine learning tutorials 2026" with depth 2
```

### Find cheap SSDs on tap.az

```
Use tapaz_search to find "SSD 512GB" with min_price 30 in komputer-avadanliqi category
```

### Search cars on turbo.az

```
Use turboaz_search to find Mercedes-Benz under 15000 AZN sorted by price
```

### Find apartments on bina.az

```
Use binaaz_search to find rentals in Baku under 500 AZN with at least 2 rooms
```

### Search in Azerbaijani

```
Use az_search to find "Bakı texnologiya startapları"
```

## Configuration

Environment variables (set in `.env` or MCP config):

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARXNG_URL` | `http://localhost:8080` | SearXNG instance URL |
| `REQUEST_TIMEOUT` | `10000` | HTTP request timeout (ms) |
| `MAX_CONCURRENT_FETCHES` | `5` | Max parallel page fetches |
| `CACHE_DIR` | `.deep-search-cache` | Cache directory path |
| `CACHE_TTL` | `3600000` | Cache TTL in ms (1 hour) |
| `MAX_CACHE_SIZE_MB` | `100` | Max cache size in MB |

## Project Structure

```
deep-search-mcp/
├── src/
│   ├── index.ts                # MCP server (9 tools)
│   ├── search/
│   │   ├── types.ts            # Shared interfaces
│   │   ├── searxng.ts          # SearXNG search engine
│   │   ├── duckduckgo.ts       # DuckDuckGo search (lite endpoint)
│   │   ├── tapaz.ts            # tap.az GraphQL API
│   │   ├── turboaz.ts          # turbo.az REST API
│   │   └── binaaz.ts           # bina.az GraphQL API
│   ├── scraper/
│   │   └── extractor.ts        # Web page content extraction
│   ├── cache/
│   │   └── cache.ts            # File-based caching system
│   ├── lang/
│   │   └── azerbaijani.ts      # Azerbaijani language detection
│   └── utils/
│       └── helpers.ts          # Utility functions
├── docker-compose.yml          # SearXNG + Redis setup
├── searxng/settings.yml        # SearXNG configuration
├── package.json
└── tsconfig.json
```

## Tech Stack

- **TypeScript** — Type-safe MCP server
- **@modelcontextprotocol/sdk** — MCP protocol implementation
- **Cheerio** — HTML parsing for web scraping
- **Zod** — Schema validation for tool parameters
- **Docker** — Optional SearXNG deployment

## Search Engines Status

| Engine | Type | Auth Required | Status |
|--------|------|---------------|--------|
| DuckDuckGo | Web Search | No | Works out of the box |
| SearXNG | Metasearch | No (self-hosted) | Requires Docker |
| tap.az | GraphQL API | No | Direct API access |
| turbo.az | REST API | No | Direct API access |
| bina.az | GraphQL API | No | Direct API access |

## License

Private project.
