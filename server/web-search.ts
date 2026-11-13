export type PublicSearchResult = { title: string; url: string; snippet: string };

const cacheTtlMs = 2 * 60 * 1000;
const maxCacheEntries = 100;
const resultCache = new Map<string, { expiresAt: number; results: PublicSearchResult[] }>();
const pendingSearches = new Map<string, Promise<PublicSearchResult[]>>();

export async function searchPublicWeb(query: string, limit = 5): Promise<PublicSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  const normalizedQuery = query.trim().replace(/\s+/g, " ").slice(0, 400);
  const safeLimit = Math.min(10, Math.max(1, Math.floor(limit) || 5));
  if (!normalizedQuery) return [];
  const key = `${normalizedQuery.toLocaleLowerCase()}::${safeLimit}`;
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results.map((result) => ({ ...result }));
  if (cached) resultCache.delete(key);
  const pending = pendingSearches.get(key);
  if (pending) return (await pending).map((result) => ({ ...result }));

  const request = fetchSearch(normalizedQuery, safeLimit, apiKey);
  pendingSearches.set(key, request);
  try {
    const results = await request;
    resultCache.set(key, { expiresAt: Date.now() + cacheTtlMs, results });
    while (resultCache.size > maxCacheEntries) {
      const oldest = resultCache.keys().next().value;
      if (!oldest) break;
      resultCache.delete(oldest);
    }
    return results.map((result) => ({ ...result }));
  } finally {
    pendingSearches.delete(key);
  }
}

async function fetchSearch(query: string, limit: number, apiKey: string): Promise<PublicSearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: limit, include_answer: false }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`网页搜索服务返回 ${response.status}。`);
  const data = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  const unique = new Map<string, PublicSearchResult>();
  for (const item of data.results ?? []) {
    if (!item.url || !item.title) continue;
    try {
      const parsed = new URL(item.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      unique.set(parsed.toString(), { title: item.title.slice(0, 180), url: parsed.toString(), snippet: (item.content ?? "").slice(0, 700) });
    } catch { /* Ignore malformed search results. */ }
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}
