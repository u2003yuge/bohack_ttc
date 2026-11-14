import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import database from "../db/competitions.json" with { type: "json" };
import { competitionCatalog, competitionSearchText, mergeCompetitionCatalog } from "./competitions.js";
import { demoKnowledgeRecords, findCompetitionBackground, findKnowledgeMatch, knowledgeRecords, normalizeKnowledgeImport } from "./knowledge.js";
import annualDatabase from "../db/competition-years.json" with { type: "json" };
import { competitionHistories, competitionYearHasInformation, normalizeCompetitionHistory } from "./competition-years.js";

test("118 catalog rows preserve every field and source from competitions.md", () => {
  const markdown = readFileSync(new URL("../competitions.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
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

test("all 118 annual histories attach to their exact competition and preserve all 354 year records", () => {
  assert.equal(competitionHistories.length, 118);
  assert.deepEqual(competitionHistories, annualDatabase.records);
  assert.equal(new Set(competitionHistories.map((history) => history.id)).size, 118);
  let years = 0;
  for (const history of competitionHistories) {
    const matches = knowledgeRecords.filter((record) => record.competition?.id === history.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].competition?.name, history.name);
    assert.deepEqual(matches[0].competition?.history, history);
    assert.deepEqual(Object.keys(history.years).sort(), ["2024", "2025", "2026"]);
    years += Object.keys(history.years).length;
  }
  assert.equal(years, 354);
  const formula = knowledgeRecords.find((record) => record.competition?.id === "2023-01")!;
  assert.equal(formula.competition?.history?.years["2024"].participants?.reported, "64支电车队、28支无人车队，共92支车队");
  assert.equal(formula.competition?.history?.years["2025"].award_rate, null);
  assert.ok(formula.competition?.history?.years["2024"].award_categories?.includes("蔚来大奖"));
  assert.equal(competitionHistories.flatMap((history) => Object.values(history.years)).filter((entry) => entry.award_categories?.length).length, 14);
  assert.ok(competitionSearchText(formula).includes("2026"));
  assert.ok(competitionSearchText(formula).includes("203支赛车队"));
  assert.equal(knowledgeRecords.find((record) => record.id === "competition-ccpc")?.competition?.history, undefined);
});

test("annual history backup preserves unknown values and scope but rejects unsafe URLs and mismatched identity", () => {
  const original = knowledgeRecords.find((record) => record.competition?.id === "2023-01")!;
  const record = { ...original, id: "custom-competition-annual-test" };
  const bundle = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [record] });
  assert.ok(!("error" in bundle));
  if ("error" in bundle) return;
  assert.deepEqual(bundle.records[0].competition?.history, original.competition?.history);
  const history = original.competition!.history!;
  assert.equal(normalizeCompetitionHistory({ ...history, years: { ...history.years, "2024": {
    ...history.years["2024"], sources: [{ title: "unsafe", url: "javascript:alert(1)" }],
  } } }), undefined);
  const invalid = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [{
    ...record, competition: { ...record.competition, history: { ...history, id: "different-competition" } },
  }] });
  if (!("error" in invalid)) assert.equal(invalid.records[0].competition, undefined);
});

test("annual display omits empty years while keeping reported zero, award categories and sources", () => {
  const empty = { ...competitionHistories[0].years["2024"], edition: null, status: null, status_basis: null,
    participants: null, award_rate: null, award_categories: null, awards: null, bonuses: null, sources: [],
    notes: "本次检索尚未核实该年度信息；null 表示未知。" };
  assert.equal(competitionYearHasInformation(empty), false);
  assert.equal(competitionYearHasInformation({ ...empty, award_rate: "  " }), false);
  assert.equal(competitionYearHasInformation({ ...empty, award_rate: "0%" }), true);
  assert.equal(competitionYearHasInformation({ ...empty, award_categories: ["一等奖"] }), true);
  assert.equal(competitionYearHasInformation({ ...empty, sources: [{ title: "官方", url: "https://example.com/" }] }), true);
  const history = competitionHistories[0];
  assert.equal(normalizeCompetitionHistory({ ...history, years: { "2024": { ...empty, award_categories: [42] } } }), undefined);
  const legacy = structuredClone(history);
  delete legacy.years["2024"].award_categories;
  assert.deepEqual(normalizeCompetitionHistory(legacy), legacy);
});
