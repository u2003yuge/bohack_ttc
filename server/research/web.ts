import { deadline, limit } from "../operations.js";

type WebResult = { title?: string; url?: string; content?: string; raw_content?: string };

export function publicUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      && url.hostname.includes(".") && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(url.hostname);
  } catch { return false; }
}

async function tavily(endpoint: "search" | "extract", body: Record<string, unknown>, signal?: AbortSignal) {
  if (!process.env.TAVILY_API_KEY) throw new Error("尚未配置 TAVILY_API_KEY。");
  const scope = deadline(signal, limit("WEB_REQUEST_TIMEOUT_MS", 15_000), "网页读取超时。");
  try {
    const response = await fetch(`https://api.tavily.com/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, api_key: process.env.TAVILY_API_KEY }),
      signal: scope.signal,
    });
    if (!response.ok) throw new Error(`网页服务返回 ${response.status}。`);
    return await response.json() as { results?: WebResult[]; failed_results?: unknown[] };
  } finally { scope.dispose(); }
}

export class ResearchWeb {
  readonly readUrls = new Set<string>();
  constructor(private readonly signal?: AbortSignal) {}

  async search(query: string): Promise<string> {
    if (!query.trim() || query.length > 500) throw new Error("查询词须为 1 到 500 个字符。");
    const data = await tavily("search", { query, search_depth: "advanced", max_results: 3, include_answer: false, include_raw_content: true }, this.signal);
    return JSON.stringify((data.results ?? []).map((result) => {
      if (publicUrl(result.url) && result.raw_content?.trim()) this.readUrls.add(result.url);
      return {
        title: result.title, url: result.url, snippet: result.content?.slice(0, 4000),
        body: result.raw_content?.slice(0, 8000) || null,
      };
    }));
  }

  async read(url: string): Promise<string> {
    if (!publicUrl(url)) throw new Error("请提供公开 HTTP(S) 页面地址。");
    const data = await tavily("extract", { urls: [url], extract_depth: "advanced" }, this.signal);
    const results = (data.results ?? []).filter((result) => publicUrl(result.url) && result.raw_content?.trim());
    for (const result of results) this.readUrls.add(result.url!);
    return JSON.stringify({
      results: results.map((result) => ({ title: result.title, url: result.url, body: result.raw_content?.slice(0, 16_000) })),
      notes: results.length ? [] : ["未能读取正文；不能将此页面列为已读取来源。"],
    });
  }
}
