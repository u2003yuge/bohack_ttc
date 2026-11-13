import assert from "node:assert/strict";
import test from "node:test";
import { findKnowledgeMatch, findKnowledgeReferences, type KnowledgeRecord } from "./knowledge.js";

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
