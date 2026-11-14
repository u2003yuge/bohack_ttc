import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AnalysisEvent, ResearchItem, ResearchReport } from "../../src/research-types.js";
import { readAnalysisEvents } from "../../src/analysis-stream.js";
import { loadSkill } from "./config.js";
import { enrichResume, skillInput } from "./runner.js";
import { ResearchStore } from "./store.js";

function entry(year = 2023): ResearchItem {
  return { kind: "competition", input: { competition_name: "示例竞赛", award_name: "一等奖", award_year: year, age_at_award: null }, context: {}, evidence: `${year} 示例竞赛一等奖`, missingFields: [], notes: [] };
}
function report(item: ResearchItem): ResearchReport {
  const result = structuredClone(loadSkill(item.kind).template) as ResearchReport;
  result.input = skillInput(item);
  (result.competition as Record<string, unknown>).official_name = "示例竞赛";
  (result.year_data as Record<string, unknown>).year = item.input.award_year;
  result.sources = [{ title: "官方结果", url: "https://example.org/result", information: "对应年份竞赛结果。" }];
  return result;
}
async function withStore(run: (store: ResearchStore) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-runtime-"));
  const keepAlive = setInterval(() => {}, 1000);
  try { await run(new ResearchStore(directory)); }
  finally {
    clearInterval(keepAlive);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("bohack-runtime-"));
    await rm(directory, { recursive: true, force: true });
  }
}

test("成果核查最多两项并发，结果仍按简历顺序返回", async () => withStore(async (store) => {
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const run = enrichResume("resume", {
    store, canSearch: true, extract: async () => ({ items: [entry(2023), entry(2024), entry(2025)], notes: [] }),
    research: async (item) => {
      active += 1; maximum = Math.max(maximum, active);
      if (active === 2) ready();
      await gate;
      active -= 1;
      return report(item);
    },
  });
  await started;
  assert.equal(maximum, 2);
  release();
  const result = await run;
  assert.equal(maximum, 2);
  assert.deepEqual(result.items.map((item) => item.item.input.award_year), [2023, 2024, 2025]);
}));

test("单项超时不会永久等待不响应的适配器，也不会写入缓存", async () => withStore(async (store) => {
  const result = await enrichResume("resume", {
    store, canSearch: true, itemTimeoutMs: 20, timeoutMs: 1000,
    extract: async () => ({ items: [entry()], notes: [] }),
    research: async () => new Promise<ResearchReport>(() => {}),
  });
  assert.equal(result.items[0].status, "error");
  assert.match(result.items[0].error!, /单项.*超时/);
  assert.equal(await store.get(entry()), null);
}));

test("核查总时限会终止在途和排队条目，并保留已完成进度", async () => withStore(async (store) => {
  const updates: number[] = [];
  const result = await enrichResume("resume", {
    store, canSearch: true, timeoutMs: 35, itemTimeoutMs: 1000,
    extract: async () => ({ items: [entry(2023), entry(2024), entry(2025)], notes: [] }),
    research: async () => new Promise<ResearchReport>(() => {}),
    onUpdate: (batch) => updates.push(batch.items.length),
  });
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every((item) => item.status === "error" && item.error?.includes("总时限")));
  assert.deepEqual(updates, [1, 2, 3]);
  assert.ok(result.notes.some((note) => note.includes("总时限")));
}));

test("提取开始即报告进度，资料完成时立即推送", async () => withStore(async (store) => {
  const events: string[] = [];
  await enrichResume("resume", {
    store, canSearch: false,
    extract: async () => { events.push("extract-called"); return { items: [entry()], notes: [] }; },
    onProgress: (progress) => events.push(progress.stage),
    onUpdate: () => events.push("updated"),
  });
  assert.equal(events[0], "extracting");
  assert.equal(events[1], "extract-called");
  assert.ok(events.includes("updated"));
}));

test("取消唯一等待者时，中断共享检索且不产生迟到缓存", async () => withStore(async (store) => {
  const controller = new AbortController();
  let started!: () => void;
  let workSignal: AbortSignal | undefined;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const result = enrichResume("resume", {
    store, canSearch: true, signal: controller.signal,
    extract: async () => ({ items: [entry()], notes: [] }),
    research: async (_item, options) => { workSignal = options?.signal; started(); return new Promise<ResearchReport>(() => {}); },
  });
  const outcome = result.catch((error: unknown) => error);
  await ready;
  controller.abort(new Error("用户取消测试"));
  assert.match(String(await outcome), /用户取消/);
  assert.equal(workSignal?.aborted, true);
  assert.equal(await store.get(entry()), null);
}));

test("取消一个请求不会中止另一个请求正在等待的相同成果", async () => withStore(async (store) => {
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const dependencies = {
    store, canSearch: true,
    extract: async () => ({ items: [entry()], notes: [] }),
    research: async (item: ResearchItem) => { await gate; return report(item); },
  };
  const first = enrichResume("resume", { ...dependencies, signal: controller.signal }).catch((error: unknown) => error);
  const second = enrichResume("resume", dependencies);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  controller.abort(new Error("用户取消测试"));
  release();
  assert.match(String(await first), /用户取消/);
  assert.equal((await second).items[0].status, "researched");
}));

test("前端支持跨字节分块的中文进度和最终结果", async () => {
  const events: AnalysisEvent[] = [
    { type: "progress", progress: { stage: "extracting", message: "正在提取中文简历" } },
    { type: "complete", answer: "已完成", research: { items: [], notes: [] } },
  ];
  const bytes = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close(); } });
  const received: AnalysisEvent[] = [];
  await readAnalysisEvents(new Response(stream), (event) => received.push(event));
  assert.deepEqual(received, events);
});

test("前端在连接提前结束时返回明确错误，避免持续显示分析中", async () => {
  const response = new Response(`${JSON.stringify({ type: "heartbeat" })}\n`);
  await assert.rejects(readAnalysisEvents(response, () => {}), /连接提前结束/);
});

test("前端先接收已完成资料，再显示服务端超时错误", async () => {
  const batch = { items: [], notes: ["已有资料可查看"] };
  const received: AnalysisEvent[] = [];
  const response = new Response(`${JSON.stringify({ type: "research", research: batch })}\n${JSON.stringify({ type: "error", error: "模型分析超时" })}\n`);
  await assert.rejects(readAnalysisEvents(response, (event) => received.push(event)), /模型分析超时/);
  assert.equal(received[0].type, "research");
});
