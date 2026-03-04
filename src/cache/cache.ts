import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const CACHE_DIR = process.env.CACHE_DIR || join(process.cwd(), ".deep-search-cache");
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL || "3600000"); // 1 hour default
const MAX_CACHE_SIZE_MB = parseInt(process.env.MAX_CACHE_SIZE_MB || "100");

function ensureCacheDir(subdir: string): string {
  const dir = join(CACHE_DIR, subdir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export function getCached<T>(category: string, key: string): T | null {
  try {
    const dir = ensureCacheDir(category);
    const file = join(dir, `${hashKey(key)}.json`);

    if (!existsSync(file)) return null;

    const raw = readFileSync(file, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(raw);

    if (Date.now() - entry.timestamp > entry.ttl) {
      unlinkSync(file);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export function setCache<T>(category: string, key: string, data: T, ttl?: number): void {
  try {
    const dir = ensureCacheDir(category);
    const file = join(dir, `${hashKey(key)}.json`);

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl ?? CACHE_TTL_MS,
    };

    writeFileSync(file, JSON.stringify(entry), "utf-8");
  } catch {
    // silently fail - caching is optional
  }
}

export function clearCache(category?: string): number {
  let cleared = 0;
  try {
    if (category) {
      const dir = join(CACHE_DIR, category);
      if (existsSync(dir)) {
        for (const file of readdirSync(dir)) {
          unlinkSync(join(dir, file));
          cleared++;
        }
      }
    } else if (existsSync(CACHE_DIR)) {
      for (const sub of readdirSync(CACHE_DIR)) {
        const subDir = join(CACHE_DIR, sub);
        const stat = statSync(subDir);
        if (stat.isDirectory()) {
          for (const file of readdirSync(subDir)) {
            unlinkSync(join(subDir, file));
            cleared++;
          }
        }
      }
    }
  } catch {
    // ignore cleanup errors
  }
  return cleared;
}

export function getCacheStats(): { categories: Record<string, number>; totalFiles: number; totalSizeMB: number } {
  const stats: Record<string, number> = {};
  let totalFiles = 0;
  let totalSize = 0;

  try {
    if (!existsSync(CACHE_DIR)) {
      return { categories: {}, totalFiles: 0, totalSizeMB: 0 };
    }

    for (const sub of readdirSync(CACHE_DIR)) {
      const subDir = join(CACHE_DIR, sub);
      const st = statSync(subDir);
      if (st.isDirectory()) {
        const files = readdirSync(subDir);
        stats[sub] = files.length;
        totalFiles += files.length;
        for (const file of files) {
          totalSize += statSync(join(subDir, file)).size;
        }
      }
    }
  } catch {
    // ignore errors
  }

  return {
    categories: stats,
    totalFiles,
    totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
  };
}

export function pruneCache(): number {
  let pruned = 0;
  try {
    if (!existsSync(CACHE_DIR)) return 0;

    for (const sub of readdirSync(CACHE_DIR)) {
      const subDir = join(CACHE_DIR, sub);
      const st = statSync(subDir);
      if (!st.isDirectory()) continue;

      for (const file of readdirSync(subDir)) {
        const filePath = join(subDir, file);
        try {
          const raw = readFileSync(filePath, "utf-8");
          const entry: CacheEntry<unknown> = JSON.parse(raw);
          if (Date.now() - entry.timestamp > entry.ttl) {
            unlinkSync(filePath);
            pruned++;
          }
        } catch {
          unlinkSync(filePath);
          pruned++;
        }
      }
    }
  } catch {
    // ignore errors
  }
  return pruned;
}
