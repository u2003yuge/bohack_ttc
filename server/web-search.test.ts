import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { searchPublicWeb } from "./web-search.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalApiKey;
});

test("deduplicates concurrent normalized queries and returns isolated results", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body)) as { query: string; max_results: number };
    assert.equal(request.max_results, 5);
    assert.match(request.query, /cache test/);
    return new Response(JSON.stringify({ results: [{ title: "Example", url: "https://example.com", content: "snippet" }] }), { status: 200 });
  }) as typeof fetch;

  const query = `${randomUUID()} cache test`;
  const [first, concurrent] = await Promise.all([
    searchPublicWeb(`  ${query}  `),
    searchPublicWeb(query.toLocaleUpperCase()),
  ]);
  first[0].title = "mutated";
  const cached = await searchPublicWeb(query);

  assert.equal(calls, 1);
  assert.equal(concurrent[0]?.title, "Example");
  assert.equal(cached[0]?.title, "Example");
});

test("does not cache failed searches", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response("{}", { status: 503 });
    return new Response(JSON.stringify({ results: [{ title: "Recovered", url: "https://example.org", content: "ok" }] }), { status: 200 });
  }) as typeof fetch;

  const query = `${randomUUID()} retry test`;
  await assert.rejects(searchPublicWeb(query), /网页搜索服务返回 503/);
  const recovered = await searchPublicWeb(query);

  assert.equal(calls, 2);
  assert.equal(recovered[0]?.title, "Recovered");
});
