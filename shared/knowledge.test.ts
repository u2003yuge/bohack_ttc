import assert from "node:assert/strict";
import test from "node:test";
import { demoKnowledgeRecords, findKnowledgeDuplicate, findKnowledgeMatch, findKnowledgeReferences, getKnowledgeReadiness, knowledgeRecords, knowledgeReviewTimelineX, normalizeKnowledgeEvidenceSources, normalizeKnowledgeFilterDraft, normalizeKnowledgeImport, summarizeKnowledgeReadiness, summarizeKnowledgeScoreBands, type KnowledgeRecord } from "./knowledge.js";

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

test("knowledge review chart spaces points by elapsed time and falls back for identical timestamps", () => {
  assert.deepEqual(knowledgeReviewTimelineX(["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-11T00:00:00Z"], 20, 200), [20, 38, 200]);
  assert.deepEqual(knowledgeReviewTimelineX(["2026-01-01", "2026-01-01", "2026-01-01"], 20, 200), [20, 110, 200]);
});

test("finds a matching alias in resume text and preserves its original casing", () => {
  assert.equal(findKnowledgeMatch("曾参加 acm-icpc 区域赛。", record), "acm-icpc");
});

test("does not create a cross reference from an empty or unrelated resume body", () => {
  assert.equal(findKnowledgeMatch("负责算法平台开发。", record), null);
  assert.deepEqual(findKnowledgeReferences("负责算法平台开发。", [record]), []);
});

test("matches Latin abbreviations on word boundaries but allows adjacent Chinese text", () => {
  const abbreviated = { ...record, title: "人工智能", aliases: ["AI"] };
  assert.equal(findKnowledgeMatch("AI竞赛项目", abbreviated), "AI");
  assert.equal(findKnowledgeMatch("trained models with AIdetection", abbreviated), null);
});

test("returns only records that match the supplied resume body", () => {
  assert.deepEqual(findKnowledgeReferences("获得 ICPC 区域赛奖项。", [record]), [record]);
});

test("deduplicates competition editions and regional stations as one series", () => {
  const existing: KnowledgeRecord = {
    ...record,
    title: "全国大学生数学建模竞赛",
    aliases: ["数学建模竞赛"],
    officialUrl: "https://example.org/math-contest/",
  };
  const duplicate = findKnowledgeDuplicate({
    kind: "competition",
    title: "2024 年全国大学生数学建模竞赛华东赛区",
    aliases: ["数学建模竞赛·华东分赛站"],
    officialUrl: "",
  }, [existing]);
  assert.equal(duplicate?.record.id, existing.id);
  assert.equal(duplicate?.reason, "competition-series");
});

test("keeps distinct competition series separate", () => {
  const existing: KnowledgeRecord = { ...record, title: "全国大学生数学建模竞赛", aliases: ["数学建模竞赛"] };
  assert.equal(findKnowledgeDuplicate({ kind: "competition", title: "全国大学生程序设计竞赛", aliases: ["程序设计竞赛"] }, [existing]), undefined);
});

test("cross references prioritize the most specific matching name", () => {
  const broad = { ...record, id: "broad", title: "AI", aliases: [] };
  const specific = { ...record, id: "specific", title: "AI 研究竞赛", aliases: [] };
  assert.deepEqual(findKnowledgeReferences("AI 研究竞赛获奖。", [broad, specific]), [specific, broad]);
});

test("seed knowledge library covers all three categories with distinct official entries", () => {
  assert.equal(demoKnowledgeRecords.length, 23);
  assert.deepEqual(new Set(demoKnowledgeRecords.map((item) => item.kind)), new Set(["competition", "journal", "company"]));
  assert.equal(new Set(demoKnowledgeRecords.map((item) => item.id)).size, demoKnowledgeRecords.length);
  assert.ok(demoKnowledgeRecords.filter((item) => item.kind === "competition").length >= 8);
  assert.ok(demoKnowledgeRecords.filter((item) => item.kind === "journal").length >= 7);
  assert.ok(demoKnowledgeRecords.filter((item) => item.kind === "company").length >= 8);
  assert.ok(demoKnowledgeRecords.every((item) => item.verificationStatus === "示例资料，待核验"));
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
    readiness: "sources-pending", query: ` ${"x".repeat(140)} `, linkedOnly: true, sort: "score", rationale: ` ${"r".repeat(260)} `,
  });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.query.length, 120);
  assert.equal(draft.rationale.length, 240);
  assert.equal(draft.linkedOnly, true);
  assert.equal(draft.reviewFilter, "reviewed");
  assert.equal(draft.readiness, "sources-pending");
});

test("knowledge filter drafts reject invented filter values", () => {
  const draft = normalizeKnowledgeFilterDraft({ kind: "candidate", verificationFilter: "all", evidenceFilter: "all", scoreBand: "all", reviewFilter: "all", readiness: "unknown", linkedOnly: false, sort: "score" });
  assert.deepEqual(draft, { error: "筛选草案包含无效选项，请重新生成。" });
});

test("knowledge filter drafts treat a missing readiness field as an unrestricted historical value", () => {
  const draft = normalizeKnowledgeFilterDraft({ kind: "all", verificationFilter: "all", evidenceFilter: "all", scoreBand: "all", reviewFilter: "all", linkedOnly: false, sort: "default" });
  assert.equal("error" in draft, false);
  if (!("error" in draft)) assert.equal(draft.readiness, "all");
});

test("knowledge score bands separate saved human reviews from pending example scores", () => {
  const bands = summarizeKnowledgeScoreBands([
    { ...record, significanceScore: 49, reviewHistory: [{ id: "review-1", significanceScore: 49, scoreRationale: "已核对", verificationStatus: "已核验", updatedAt: "2026-01-01", source: "manual" }] },
    { ...record, id: "pending-50", significanceScore: 50, reviewHistory: undefined },
  ]);
  assert.deepEqual(bands.find((band) => band.key === "0-49"), { key: "0-49", label: "0–49", min: 0, max: 49, count: 1, reviewed: 1, pending: 0 });
  assert.deepEqual(bands.find((band) => band.key === "50-69"), { key: "50-69", label: "50–69", min: 50, max: 69, count: 1, reviewed: 0, pending: 1 });
});

test("knowledge readiness separates source gaps, verification, human review, and completion", () => {
  const verifiedSource = normalizeKnowledgeEvidenceSources([{ id: "checked", title: "Official result", url: "https://example.org/result", verified: true }])[0];
  const reviewed = { id: "review-1", significanceScore: 74, scoreRationale: "核对完毕", verificationStatus: "已核验" as const, updatedAt: "2026-11-14", source: "manual" as const };
  const records = [
    { ...record, id: "missing", officialUrl: "", evidenceSources: [] },
    { ...record, id: "unverified", evidenceSources: [] },
    { ...record, id: "review-pending", evidenceSources: [verifiedSource] },
    { ...record, id: "complete", evidenceSources: [verifiedSource], verificationStatus: "已核验" as const, reviewHistory: [reviewed] },
  ];
  assert.deepEqual(records.map(getKnowledgeReadiness), ["missing-sources", "sources-pending", "review-pending", "complete"]);
  assert.deepEqual(summarizeKnowledgeReadiness(records).map(({ key, count }) => [key, count]), [
    ["missing-sources", 1], ["sources-pending", 1], ["review-pending", 1], ["complete", 1],
  ]);
});

test("knowledge import validates and preserves custom records and bounded review history", () => {
  const bundle = normalizeKnowledgeImport({
    format: "bohack-knowledge-library", version: 1, exportedAt: "2026-11-14T00:00:00.000Z",
    records: [{ ...record, id: "custom-12345678", officialUrl: "javascript:alert(1)", significanceScore: 72,
      reviewHistory: [{ id: "review-1", significanceScore: 74, scoreRationale: "已核对", verificationStatus: "已核验", updatedAt: "2026-11-14T00:00:00.000Z", source: "manual" }],
    }],
  });
  assert.equal("error" in bundle, false);
  if ("error" in bundle) return;
  assert.equal(bundle.records[0].officialUrl, "");
  assert.equal(bundle.records[0].reviewHistory?.[0].significanceScore, 74);
  assert.equal(bundle.records[0].reviewHistory?.[0].verificationStatus, "已核验");
});

test("knowledge import rejects built-in IDs, duplicates, and unsupported bundle versions", () => {
  const base = { ...record, id: "custom-12345678" };
  assert.ok("error" in normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [{ ...base, id: record.id }] }));
  assert.ok("error" in normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [base, base] }));
  assert.ok("error" in normalizeKnowledgeImport({ format: "other", version: 2, records: [base] }));
  assert.ok("error" in normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [{ ...base, significanceScore: null }] }));
});

test("knowledge backup restores built-in review history without built-in record bodies", () => {
  const builtInId = knowledgeRecords[0].id;
  const sourceId = "official-result-2026";
  const bundle = normalizeKnowledgeImport({
    format: "bohack-knowledge-library", version: 1, records: [],
    reviews: { [builtInId]: [
      { id: "review-old", significanceScore: 61, scoreRationale: "旧评分", verificationStatus: "示例资料，待核验", updatedAt: "2026-10-01", source: "manual", evidenceSourceIds: [sourceId] },
      { id: "review-new", significanceScore: 88, scoreRationale: "核对官方获奖名单", verificationStatus: "已核验", updatedAt: "2026-11-14", source: "ai-assisted", evidenceSourceIds: [sourceId], evidenceSources: [{ id: sourceId, title: "官方结果", url: "https://example.com/results", sourceType: "official", dataYear: "2026", note: "名单页面", verified: true, checkedAt: "2026-11-14" }] },
    ] },
  });
  assert.equal("error" in bundle, false);
  if ("error" in bundle) return;
  assert.deepEqual(bundle.records, []);
  const history = bundle.reviews?.[builtInId] ?? [];
  assert.equal(history.length, 2);
  assert.equal(history.at(-1)?.significanceScore, 88);
  assert.equal(history.at(-1)?.verificationStatus, "已核验");
  assert.deepEqual(history.at(-1)?.evidenceSourceIds, [sourceId]);
  assert.equal(history.at(-1)?.evidenceSources?.[0].title, "官方结果");
});

test("knowledge backup rejects review histories for unknown record IDs", () => {
  const result = normalizeKnowledgeImport({
    format: "bohack-knowledge-library", version: 1, records: [],
    reviews: { "custom-unknown1": [{ significanceScore: 80, updatedAt: "2026-11-14" }] },
  });
  assert.ok("error" in result);
});
