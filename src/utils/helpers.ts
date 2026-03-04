export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function formatTimestamp(): string {
  return new Date().toISOString();
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage = "Operation timed out"
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}

export function deduplicateByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = item.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function buildResultSummary(
  query: string,
  results: { title: string; url: string; content: string }[]
): string {
  const parts: string[] = [
    `# Deep Search Results: "${query}"`,
    `**Found ${results.length} result(s)**`,
    `**Timestamp:** ${formatTimestamp()}`,
    "",
    "---",
    "",
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    parts.push(`## ${i + 1}. ${r.title || "Untitled"}`);
    parts.push(`**URL:** ${r.url}`);
    parts.push("");
    parts.push(r.content || "*No content extracted*");
    parts.push("");
    parts.push("---");
    parts.push("");
  }

  return parts.join("\n");
}
