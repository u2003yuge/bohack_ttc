import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAnalysisTaskDraft, normalizeKnowledgeEnrichment, normalizeProjectBreakdownDraft, normalizeProjectBreakdownRequest, normalizeProjectBreakdownSources } from "./analysis.js";

const sources = [
  { title: "Official venue", url: "https://neurips.cc/", snippet: "Conference website" },
  { title: "University news", url: "https://university.example/news", snippet: "A research story" },
];

test("knowledge enrichment only keeps a source URL returned by search", () => {
  const normalized = normalizeKnowledgeEnrichment({ officialUrl: "https://fake.example/", confidence: 1.4 }, sources);
  assert.equal(normalized.officialUrl, "");
  assert.equal(normalized.confidence, 1);
});

test("knowledge enrichment bounds generated lists and accepts exact source URLs", () => {
  const normalized = normalizeKnowledgeEnrichment({
    aliases: Array.from({ length: 12 }, (_, index) => `alias-${index}`),
    signals: Array.from({ length: 9 }, (_, index) => `signal-${index}`),
    officialUrl: "https://neurips.cc/",
    confidence: 0.6,
  }, sources);
  assert.equal(normalized.officialUrl, "https://neurips.cc/");
  assert.equal(normalized.aliases.length, 8);
  assert.equal(normalized.signals.length, 6);
});

test("analysis task drafts require a useful prompt and bound generated text", () => {
  assert.ok("error" in normalizeAnalysisTaskDraft({ question: "太短" }));
  const draft = normalizeAnalysisTaskDraft({ question: ` ${"请逐项核查简历证据。".repeat(100)} `, rationale: " 已拆分核查任务 " });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.question.length, 800);
  assert.equal(draft.rationale, "已拆分核查任务");
});

test("project breakdown inputs require bounded source text", () => {
  assert.ok("error" in normalizeProjectBreakdownSources([]));
  assert.ok("error" in normalizeProjectBreakdownSources([{ title: "经历", content: "" }]));
  assert.ok("error" in normalizeProjectBreakdownSources(Array.from({ length: 5 }, () => ({ title: "经历", content: "描述" }))));
  const normalized = normalizeProjectBreakdownSources([{ title: " 项目 A ", content: ` ${"原文".repeat(1400)} ` }]);
  assert.equal("error" in normalized, false);
  if ("error" in normalized) return;
  assert.equal(normalized.sources[0].title, "项目 A");
  assert.equal(normalized.sources[0].content.length, 2500);
});

test("project breakdown reviewer focus is trimmed and bounded separately from resume evidence", () => {
  const normalized = normalizeProjectBreakdownRequest({ projects: [{ title: "经历", content: "主导搭建系统" }], reviewerFocus: `  ${"突出个人贡献。".repeat(100)}  ` });
  assert.equal("error" in normalized, false);
  if ("error" in normalized) return;
  assert.equal(normalized.reviewerFocus.length, 500);
  assert.equal(normalized.sources[0].content, "主导搭建系统");
});

test("project breakdown drafts accept only unique in-range indexes with exact resume evidence", () => {
  const sources = [{ title: "项目 A", content: "主导搭建数据分析平台，降低报表耗时 30%。" }, { title: "项目 B", content: "负责客户需求调研和方案交付。" }];
  assert.ok("error" in normalizeProjectBreakdownDraft({ projects: [{ sourceIndex: 0, evidence: "模型编造的内容" }] }, sources));
  assert.ok("error" in normalizeProjectBreakdownDraft({ projects: [{ sourceIndex: 0, evidence: "负责" }] }, sources));
  const normalized = normalizeProjectBreakdownDraft({ projects: [
    { sourceIndex: 0, plainTitle: "让数据报表更快", goal: "提升报表效率", actions: "搭建平台", outcome: "报表耗时降低 30%", evidence: "降低报表耗时 30%", confidence: 0.8 },
    { sourceIndex: 0, plainTitle: "重复项目", evidence: "主导搭建" },
    { sourceIndex: 1, plainTitle: "需求调研", evidence: "候选人带领 20 人团队" },
    { sourceIndex: 5, plainTitle: "越界项目", evidence: "证据" },
  ] }, sources);
  assert.equal("error" in normalized, false);
  if ("error" in normalized) return;
  assert.equal(normalized.projects.length, 1);
  assert.equal(normalized.projects[0].title, "项目 A");
  assert.equal(normalized.projects[0].evidence, "降低报表耗时 30%");
  assert.equal("confidence" in normalized.projects[0], false);
});
