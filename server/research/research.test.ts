import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ResearchItem, ResearchReport } from "../../src/research-types.js";
import { loadSkill } from "./config.js";
import { validateExtraction } from "./extract.js";
import { enrichResume, researchItem, skillInput, validateReport } from "./runner.js";
import { cacheKey, ResearchStore } from "./store.js";

const sourceUrl = "https://example.org/2023/results";
function item(overrides: Partial<ResearchItem> = {}): ResearchItem {
  return {
    kind: "competition",
    input: { competition_name: "示例建模竞赛", award_name: "全国一等奖", award_year: 2023, age_at_award: null },
    context: { division: "本科组", track: null, stage: null, region: null },
    evidence: "2023 年示例建模竞赛本科组全国一等奖",
    missingFields: [], notes: [], ...overrides,
  };
}
function report(entry = item()): ResearchReport {
  const result = structuredClone(loadSkill(entry.kind).template) as ResearchReport;
  result.input = skillInput(entry);
  if (entry.kind === "paper") (result.paper as Record<string, unknown>).official_title = entry.input.title;
  else {
    (result[entry.kind] as Record<string, unknown>).official_name = entry.input[entry.kind === "competition" ? "competition_name" : "project_name"];
    (result.year_data as Record<string, unknown>).year = entry.input[entry.kind === "competition" ? "award_year" : "project_year"];
  }
  result.sources = [{ title: "官方结果", url: sourceUrl, information: "2023 年本科组结果。" }];
  return result;
}
async function withStore(run: (store: ResearchStore) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-research-"));
  try { await run(new ResearchStore(directory)); }
  finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("bohack-research-"));
    await rm(directory, { recursive: true, force: true });
  }
}

test("提取三类 skill 的输入，保留原文和缺失字段", () => {
  const text = "2023 年示例建模竞赛本科组全国一等奖\n论文 Example Paper\n2022-2024 年校内检索平台，后端开发";
  const extracted = validateExtraction({ items: [
    item(),
    { kind: "paper", input: { title: "Example Paper", description: null }, context: {}, evidence: "论文 Example Paper" },
    { kind: "project", input: { project_name: "校内检索平台", project_year: "2022-2024", organization: null, role: "后端开发" }, context: {}, evidence: "2022-2024 年校内检索平台，后端开发" },
  ] }, text);
  assert.equal(extracted.items.length, 3);
  assert.equal(extracted.items[0].input.age_at_award, null);
  assert.equal(extracted.items[2].input.project_year, "2022-2024");
  assert.deepEqual(extracted.items[2].missingFields, ["organization"]);
});

test("拒绝改写的原文证据，清空证据中不存在的字段", () => {
  const evidence = "2023 年示例建模竞赛全国一等奖";
  const result = validateExtraction({ items: [
    { ...item(), evidence, input: { ...item().input, age_at_award: 21 } },
    { ...item(), evidence: "改写的片段" },
    { kind: "__proto__", input: {}, evidence },
  ] }, evidence);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].input.age_at_award, null);
  assert.equal(result.items[0].context.division, null);
  assert.ok(result.notes.length >= 2);
});

test("允许 OCR 空白差异并恢复原始连续片段，不因模型合并空格丢弃成果", () => {
  const original = "２０２３ 年 示 例建模竞赛\n本科组 全国一等奖";
  const result = validateExtraction({ items: [{ ...item(), evidence: "2023年示例建模竞赛 本科组全国一等奖" }] }, original);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].evidence, original);
  assert.equal(result.items[0].input.award_year, 2023);
});

test("缓存按年份、奖项、组别分开，年龄不影响复用", () => {
  const entry = item();
  assert.equal(cacheKey(entry), cacheKey({ ...entry, input: { ...entry.input, age_at_award: 24 } }));
  for (const other of [
    { ...entry, input: { ...entry.input, award_year: 2024 } },
    { ...entry, input: { ...entry.input, award_name: "省一等奖" } },
    { ...entry, context: { ...entry.context, division: "专科组" } },
  ]) assert.notEqual(cacheKey(entry), cacheKey(other));
});

test("同名项目按机构及角色区分，同名论文按 DOI 和轨道区分", () => {
  const project = item({ kind: "project", input: { project_name: "检索平台", project_year: 2024, organization: "甲实验室", role: null }, context: {} });
  assert.notEqual(cacheKey(project), cacheKey({ ...project, input: { ...project.input, organization: "乙实验室" } }));
  assert.notEqual(cacheKey(project), cacheKey({ ...project, input: { ...project.input, role: "负责人" } }));
  const paper = item({ kind: "paper", input: { title: "Same Title", description: null }, context: { doi: "10.1/abc", track: "Workshop" } });
  assert.notEqual(cacheKey(paper), cacheKey({ ...paper, context: { doi: "10.1/def", track: "Workshop" } }));
  assert.notEqual(cacheKey(paper), cacheKey({ ...paper, context: { doi: "10.1/abc", track: "主会" } }));
});

test("未实际读到正文的来源不能入库；保留六块格式", () => {
  assert.throws(() => validateReport(report(), item(), new Set()), /尚未读取/);
  assert.equal(validateReport(report(), item(), new Set([sourceUrl])).sources.length, 1);
  const invalid = report();
  delete invalid.competition;
  assert.throws(() => validateReport(invalid, item()), /六块/);
});

test("重复成果直接命中数据库，当前简历的年龄重新填入 input", async () => withStore(async (store) => {
  let calls = 0;
  const run = async (entry: ResearchItem) => {
    calls += 1;
    return report(entry);
  };
  const first = await enrichResume("resume", { store, canSearch: true, extract: async () => ({ items: [item()], notes: [] }), research: run });
  const secondItem = item({ input: { ...item().input, age_at_award: 22 } });
  const second = await enrichResume("resume", { store, canSearch: false, extract: async () => ({ items: [secondItem], notes: [] }), research: run });
  assert.equal(first.items[0].status, "researched");
  assert.equal(second.items[0].status, "cached");
  assert.equal(second.items[0].report?.input.age_at_award, 22);
  assert.equal(calls, 1);
}));

test("缺少输入与未配置搜索服务时明确待补充，不启动检索", async () => withStore(async (store) => {
  const results = await enrichResume("resume", {
    store, canSearch: false,
    extract: async () => ({ items: [item({ missingFields: ["award_year"] }), item()], notes: [] }),
    research: async () => { throw new Error("不应联网"); },
  });
  assert.deepEqual(results.items.map((result) => result.status), ["pending", "pending"]);
  assert.match(results.items[0].error!, /award_year/);
  assert.match(results.items[1].error!, /TAVILY/);
}));

test("未确认身份的报告保存为历史资料，不污染后续命中", async () => withStore(async (store) => {
  const partial = report();
  (partial.competition as Record<string, unknown>).official_name = null;
  const result = await enrichResume("resume", {
    store, canSearch: true, extract: async () => ({ items: [item()], notes: [] }), research: async () => partial,
  });
  assert.equal(result.items[0].status, "pending");
  assert.equal(await store.get(item()), null);
  const files = await readdir(path.join(store.directory, "competition", cacheKey(item())));
  assert.equal(files.filter((name) => name.startsWith("report-")).length, 1);
  assert.ok(!files.includes("latest.json"));
}));

test("过期报告不命中；新检索不覆盖旧报告", async () => withStore(async (store) => {
  await store.put(item(), report(), true);
  const expiredStore = new ResearchStore(store.directory, -1);
  assert.equal(await expiredStore.get(item()), null);
  await store.put(item(), report(), true);
  const files = await readdir(path.join(store.directory, "competition", cacheKey(item())));
  assert.equal(files.filter((name) => name.startsWith("report-")).length, 2);
}));

test("索引损坏时报告错误，不把损坏当成未命中后覆盖", async () => withStore(async (store) => {
  await store.put(item(), report(), true);
  await writeFile(path.join(store.directory, "competition", cacheKey(item()), "latest.json"), "null", "utf8");
  await assert.rejects(store.get(item()), /索引格式无效/);
}));

test("并发请求同一成果只检索一次", async () => withStore(async (store) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const dependencies = {
    store, canSearch: true, extract: async () => ({ items: [item()], notes: [] }),
    research: async () => { calls += 1; await gate; return report(); },
  };
  const first = enrichResume("resume", dependencies);
  const second = enrichResume("resume", dependencies);
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.ok(results.every((result) => result.items[0].status === "researched"));
}));

test("一条检索失败时仍处理后续成果", async () => withStore(async (store) => {
  const other = item({ input: { ...item().input, award_year: 2024 } });
  const result = await enrichResume("resume", {
    store, canSearch: true, extract: async () => ({ items: [item(), other], notes: [] }),
    research: async (entry) => { if (entry.input.award_year === 2023) throw new Error("搜索超时"); return report(entry); },
  });
  assert.deepEqual(result.items.map((entry) => entry.status), ["error", "researched"]);
}));

test("使用真实 Chat Completions 工具循环读取来源并生成 skill 报告（本地服务模拟）", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL, tavily: process.env.TAVILY_API_KEY };
  let turns = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body) as { messages: Array<{ role: string; content?: string }> };
    turns += 1;
    if (turns >= 2) assert.ok(payload.messages.some((message) => message.role === "tool" && message.content?.includes(sourceUrl)));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "mock", object: "chat.completion", created: 1, model: "test", choices: [{ index: 0, finish_reason: turns <= 2 ? "tool_calls" : "stop", message: turns === 1
      ? { role: "assistant", content: null, tool_calls: [{ id: "search-1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "示例建模竞赛 2023" }) } }] }
      : turns === 2 ? { role: "assistant", content: null, tool_calls: [{ id: "read-1", type: "function", function: { name: "web_read", arguments: JSON.stringify({ url: sourceUrl }) } }] }
      : { role: "assistant", content: JSON.stringify(report()) } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.OPENAI_API_KEY = "local-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.TAVILY_API_KEY = "local-test";
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://api.tavily.com/search") return new Response(JSON.stringify({ results: [{ title: "官方结果", url: sourceUrl, content: "搜索摘要，仅供线索。" }] }));
    if (String(input) === "https://api.tavily.com/extract") return new Response(JSON.stringify({ results: [{ title: "官方结果", url: sourceUrl, raw_content: "2023 年本科组全国一等奖结果。" }] }));
    return originalFetch(input, init);
  };
  try {
    const result = await researchItem(item());
    assert.equal(result.sources[0].url, sourceUrl);
    assert.equal(turns, 3);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: originalEnvironment.key, OPENAI_BASE_URL: originalEnvironment.base, TAVILY_API_KEY: originalEnvironment.tavily })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
