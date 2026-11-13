export type PublicSearchResult = { title: string; url: string; snippet: string };

export async function searchPublicWeb(query: string, limit = 5): Promise<PublicSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
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
