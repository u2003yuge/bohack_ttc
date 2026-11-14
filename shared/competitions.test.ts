import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import database from "../db/competitions.json" with { type: "json" };
import { competitionCatalog, competitionSearchText, mergeCompetitionCatalog } from "./competitions.js";
import { demoKnowledgeRecords, findCompetitionBackground, findKnowledgeMatch, knowledgeRecords, normalizeKnowledgeImport } from "./knowledge.js";

test("118 catalog rows preserve every field and source from competitions.md", () => {
  const markdown = readFileSync(new URL("../competitions.md", import.meta.url), "utf8");
  const raw = JSON.parse(markdown.match(/```json\s*([\s\S]*?)```/)![1]);
  assert.equal(competitionCatalog.length, 118);
  assert.deepEqual(competitionCatalog, raw);
  assert.equal(database.sourceSha256, createHash("sha256").update(markdown).digest("hex"));
  assert.equal(new Set(knowledgeRecords.map((record) => record.id)).size, knowledgeRecords.length);
});

test("catalog merges overlapping seeds while keeping review IDs, aliases and other categories", () => {
  for (const id of ["competition-acm-icpc", "competition-challenge-cup", "competition-china-innovation", "competition-blue-bridge"]) {
    const matches = knowledgeRecords.filter((record) => record.id === id);
    assert.equal(matches.length, 1);
    assert.ok(matches[0].competition);
  }
  assert.ok(findKnowledgeMatch("ICPC 区域赛获奖", knowledgeRecords.find((record) => record.id === "competition-acm-icpc")!));
  assert.deepEqual(mergeCompetitionCatalog(demoKnowledgeRecords).filter((record) => record.kind !== "competition"), demoKnowledgeRecords.filter((record) => record.kind !== "competition"));
  assert.equal(knowledgeRecords.filter((record) => record.competition).length, 118);
  const national = knowledgeRecords.find((record) => record.title === "全国大学生数学建模竞赛")!;
  assert.notEqual(national.id, "competition-mcm");
  assert.equal(national.reviewHistory, undefined);
  assert.ok(national.evidenceSources?.every((source) => !source.verified && !source.dataYear));
});

test("ability and quality keywords are searchable and matched catalog background is available offline", () => {
  const record = knowledgeRecords.find((record) => record.competition?.id === "2023-01")!;
  assert.ok(competitionSearchText(record).includes("嵌入式控制"));
  assert.ok(competitionSearchText(record).includes("系统思维"));
  const background = findCompetitionBackground(`参与${record.title}，负责控制系统。`);
  assert.equal(background.length, 1);
  assert.deepEqual(background[0].sources, record.competition?.sources);
  assert.equal(background[0].report_year, 2023);
  assert.deepEqual(findCompetitionBackground("负责公司后台 API 开发"), []);
});

test("custom competition backup round-trips detailed catalog fields without accepting unsafe URLs", () => {
  const record = { ...knowledgeRecords[0], id: "custom-competition-test" };
  const bundle = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [record] });
  assert.ok(!("error" in bundle));
  if ("error" in bundle) return;
  assert.deepEqual(bundle.records[0].competition, record.competition);
  const invalid = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1,
    records: [{ ...record, competition: { ...record.competition, official_website: "javascript:alert(1)" } }],
  });
  if (!("error" in invalid)) assert.equal(invalid.records[0].competition, undefined);
});
