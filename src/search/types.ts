export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  links: string[];
  success: boolean;
  error?: string;
}

export interface DeepSearchResult {
  query: string;
  totalResults: number;
  results: {
    title: string;
    url: string;
    snippet: string;
    fullContent: string;
    relevantLinks: string[];
  }[];
  searchDepth: number;
  enginesUsed: string[];
  timestamp: string;
}

export interface SearchEngine {
  name: string;
  search: (query: string, maxResults: number) => Promise<SearchResult[]>;
  available: () => Promise<boolean>;
}

export interface DeepSearchOptions {
  maxResults: number;
  searchDepth: number;
  maxContentLength: number;
  followLinks: boolean;
  engines: string[];
}

export const DEFAULT_OPTIONS: DeepSearchOptions = {
  maxResults: 5,
  searchDepth: 1,
  maxContentLength: 5000,
  followLinks: false,
  engines: ["searxng", "duckduckgo"],
};
