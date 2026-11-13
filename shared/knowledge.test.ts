import assert from "node:assert/strict";
import test from "node:test";
import { findKnowledgeMatch, findKnowledgeReferences, normalizeKnowledgeEvidenceSources, type KnowledgeRecord } from "./knowledge.js";

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
