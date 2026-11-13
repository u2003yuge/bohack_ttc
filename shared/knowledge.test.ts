import assert from "node:assert/strict";
import test from "node:test";
import { findKnowledgeMatch, findKnowledgeReferences, knowledgeRecords, normalizeKnowledgeEvidenceSources, normalizeKnowledgeFilterDraft, summarizeKnowledgeScoreBands, type KnowledgeRecord } from "./knowledge.js";

const record: KnowledgeRecord = {
  id: "competition-icpc",
  kind: "competition",
  title: "国际大学生程序设计竞赛",
  aliases: ["ICPC", "ACM-ICPC"],
  field: "计算机",
  organizer: "ICPC Foundation",
  region: "国际",
  summary: "算法竞赛",
  signals: [],
  officialUrl: "https://icpc.global/",
  significanceScore: 50,
  scoreRationale: "待人工评估",
  verificationStatus: "示例资料，待核验",
  updatedAt: "2026-01-01",
};

test("finds a matching alias in resume text and preserves its original casing", () => {
  assert.equal(findKnowledgeMatch("曾参加 acm-icpc 区域赛。", record), "acm-icpc");
});

test("does not create a cross reference from an empty or unrelated resume body", () => {
  assert.equal(findKnowledgeMatch("负责算法平台开发。", record), null);
  assert.deepEqual(findKnowledgeReferences("负责算法平台开发。", [record]), []);
});

test("returns only records that match the supplied resume body", () => {
  assert.deepEqual(findKnowledgeReferences("获得 ICPC 区域赛奖项。", [record]), [record]);
});

test("seed knowledge library covers all three categories with distinct official entries", () => {
  assert.equal(knowledgeRecords.length, 23);
  assert.deepEqual(new Set(knowledgeRecords.map((item) => item.kind)), new Set(["competition", "journal", "company"]));
  assert.equal(new Set(knowledgeRecords.map((item) => item.id)).size, knowledgeRecords.length);
  assert.ok(knowledgeRecords.filter((item) => item.kind === "competition").length >= 8);
  assert.ok(knowledgeRecords.filter((item) => item.kind === "journal").length >= 7);
  assert.ok(knowledgeRecords.filter((item) => item.kind === "company").length >= 8);
  assert.ok(knowledgeRecords.every((item) => item.verificationStatus === "示例资料，待核验"));
});

test("knowledge evidence sources keep valid web links and bounded review metadata", () => {
  const sources = normalizeKnowledgeEvidenceSources([
    { id: "official", title: "官方获奖公示", url: "https://example.org/result", sourceType: "official", dataYear: "2025", note: "核对总决赛获奖名单", verified: true, checkedAt: "2026-11-14T00:00:00.000Z" },
    { id: "unsafe", title: "本地文件", url: "file:///private/data.pdf", sourceType: "other" },
    { id: "duplicate", title: "重复地址", url: "https://example.org/result", sourceType: "other" },
  ]);
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0], {
    id: "official", title: "官方获奖公示", url: "https://example.org/result", sourceType: "official", dataYear: "2025",
    note: "核对总决赛获奖名单", verified: true, checkedAt: "2026-11-14T00:00:00.000Z",
  });
});

test("knowledge evidence sources cap entries and never retain a checked timestamp without checked status", () => {
  const sources = normalizeKnowledgeEvidenceSources(Array.from({ length: 14 }, (_, index) => ({
    id: `source-${index}`, title: `来源 ${index}`, url: `https://example.org/${index}`, verified: false,
    checkedAt: "2026-11-14T00:00:00.000Z",
  })));
  assert.equal(sources.length, 12);
  assert.equal(sources[0].checkedAt, "");
  assert.equal(sources[0].sourceType, "other");
});

test("changing a cited source identity clears its human verification marker", () => {
  const previous = normalizeKnowledgeEvidenceSources([{ id: "source-a", title: "官方榜单", url: "https://example.org/a", sourceType: "official", dataYear: "2025", verified: true }]);
  const updated = normalizeKnowledgeEvidenceSources([{ ...previous[0], url: "https://example.org/b" }], previous);
  assert.equal(updated[0].verified, false);
  assert.equal(updated[0].checkedAt, "");
});

test("knowledge filter drafts accept only supported filters and bound free-text fields", () => {
  const draft = normalizeKnowledgeFilterDraft({
    kind: "competition", verificationFilter: "verified", evidenceFilter: "verified-sources", scoreBand: "85-100", reviewFilter: "reviewed",
    query: ` ${"x".repeat(140)} `, linkedOnly: true, sort: "score", rationale: ` ${"r".repeat(260)} `,
  });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.query.length, 120);
  assert.equal(draft.rationale.length, 240);
  assert.equal(draft.linkedOnly, true);
  assert.equal(draft.reviewFilter, "reviewed");
});

test("knowledge filter drafts reject invented filter values", () => {
  const draft = normalizeKnowledgeFilterDraft({ kind: "candidate", verificationFilter: "all", evidenceFilter: "all", scoreBand: "all", linkedOnly: false, sort: "score" });
  assert.deepEqual(draft, { error: "筛选草案包含无效选项，请重新生成。" });
});

test("knowledge score bands separate saved human reviews from pending example scores", () => {
  const bands = summarizeKnowledgeScoreBands([
    { ...record, significanceScore: 49, reviewHistory: [{ id: "review-1", significanceScore: 49, scoreRationale: "已核对", verificationStatus: "已核验", updatedAt: "2026-01-01", source: "manual" }] },
    { ...record, id: "pending-50", significanceScore: 50, reviewHistory: undefined },
  ]);
  assert.deepEqual(bands.find((band) => band.key === "0-49"), { key: "0-49", label: "0–49", min: 0, max: 49, count: 1, reviewed: 1, pending: 0 });
  assert.deepEqual(bands.find((band) => band.key === "50-69"), { key: "50-69", label: "50–69", min: 50, max: 69, count: 1, reviewed: 0, pending: 1 });
});
