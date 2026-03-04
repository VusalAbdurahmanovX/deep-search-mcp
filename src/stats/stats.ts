import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const STATS_FILE = process.env.STATS_FILE || join(process.cwd(), "data", "stats.json");

interface SearchEntry {
  query: string;
  tool: string;
  userId?: string;
  username?: string;
  timestamp: number;
  responseTimeMs: number;
  resultCount: number;
}

interface StatsData {
  totalSearches: number;
  searches: SearchEntry[];
  userStats: Record<string, { count: number; lastActive: number; username?: string }>;
  toolStats: Record<string, number>;
  popularQueries: Record<string, number>;
  startedAt: number;
}

function ensureDir(): void {
  const dir = dirname(STATS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadStats(): StatsData {
  try {
    if (existsSync(STATS_FILE)) {
      const raw = readFileSync(STATS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // corrupted file, start fresh
  }
  return {
    totalSearches: 0,
    searches: [],
    userStats: {},
    toolStats: {},
    popularQueries: {},
    startedAt: Date.now(),
  };
}

function saveStats(data: StatsData): void {
  ensureDir();
  writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function recordSearch(entry: {
  query: string;
  tool: string;
  userId?: string;
  username?: string;
  responseTimeMs: number;
  resultCount: number;
}): void {
  const stats = loadStats();

  stats.totalSearches++;

  const searchEntry: SearchEntry = {
    ...entry,
    timestamp: Date.now(),
  };

  stats.searches.push(searchEntry);

  // keep last 1000 entries
  if (stats.searches.length > 1000) {
    stats.searches = stats.searches.slice(-1000);
  }

  // update user stats
  if (entry.userId) {
    if (!stats.userStats[entry.userId]) {
      stats.userStats[entry.userId] = { count: 0, lastActive: 0 };
    }
    stats.userStats[entry.userId].count++;
    stats.userStats[entry.userId].lastActive = Date.now();
    if (entry.username) {
      stats.userStats[entry.userId].username = entry.username;
    }
  }

  // update tool stats
  stats.toolStats[entry.tool] = (stats.toolStats[entry.tool] || 0) + 1;

  // update popular queries
  const normalizedQuery = entry.query.toLowerCase().trim();
  if (normalizedQuery.length > 0) {
    stats.popularQueries[normalizedQuery] = (stats.popularQueries[normalizedQuery] || 0) + 1;
  }

  saveStats(stats);
}

export function getStats(): {
  totalSearches: number;
  uniqueUsers: number;
  topQueries: { query: string; count: number }[];
  toolUsage: Record<string, number>;
  recentSearches: SearchEntry[];
  uptimeDays: number;
  activeUsers: { userId: string; username?: string; count: number; lastActive: string }[];
} {
  const stats = loadStats();

  const topQueries = Object.entries(stats.popularQueries)
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const activeUsers = Object.entries(stats.userStats)
    .map(([userId, data]) => ({
      userId,
      username: data.username,
      count: data.count,
      lastActive: new Date(data.lastActive).toISOString(),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const uptimeDays = Math.floor((Date.now() - stats.startedAt) / 86400000);

  return {
    totalSearches: stats.totalSearches,
    uniqueUsers: Object.keys(stats.userStats).length,
    topQueries,
    toolUsage: stats.toolStats,
    recentSearches: stats.searches.slice(-10).reverse(),
    uptimeDays,
    activeUsers,
  };
}

export function formatStatsMessage(): string {
  const s = getStats();

  const lines = [
    "📊 *Deep Search Statistics*",
    "",
    `🔍 Total searches: *${s.totalSearches}*`,
    `👥 Unique users: *${s.uniqueUsers}*`,
    `📅 Uptime: *${s.uptimeDays} days*`,
    "",
  ];

  if (Object.keys(s.toolUsage).length > 0) {
    lines.push("*Tool Usage:*");
    for (const [tool, count] of Object.entries(s.toolUsage).sort((a, b) => b[1] - a[1])) {
      lines.push(`  • ${tool}: ${count}`);
    }
    lines.push("");
  }

  if (s.topQueries.length > 0) {
    lines.push("*Top Queries:*");
    for (const q of s.topQueries.slice(0, 10)) {
      lines.push(`  ${q.count}x — ${q.query}`);
    }
    lines.push("");
  }

  if (s.activeUsers.length > 0) {
    lines.push("*Most Active Users:*");
    for (const u of s.activeUsers.slice(0, 5)) {
      const name = u.username ? `@${u.username}` : `User ${u.userId}`;
      lines.push(`  • ${name}: ${u.count} searches`);
    }
  }

  return lines.join("\n");
}
