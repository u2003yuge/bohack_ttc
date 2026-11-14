import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import database from "../db/papers.json" with { type: "json" };
import { demoKnowledgeRecords, findKnowledgeMatch, findVenueBackground, knowledgeRecords, normalizeKnowledgeImport } from "./knowledge.js";
import { mergeVenueCatalog, venueCatalog, venueSearchText } from "./venues.js";
import { normalizeVenueProfile } from "./venue-profile.js";

test("100 venue profiles and all ranking/source metadata match papers.md exactly", () => {
  const source = readFileSync(new URL("../papers.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const raw = JSON.parse(source.match(/```json\s*([\s\S]*?)```/)![1]);
  assert.equal(venueCatalog.length, 100);
  assert.deepEqual(venueCatalog, raw);
  assert.equal(database.sourceSha256, createHash("sha256").update(source).digest("hex"));
  for (const profile of venueCatalog) assert.deepEqual(normalizeVenueProfile(profile), profile);
  assert.equal(venueCatalog.filter((profile) => profile.type === "会议").length, 55);
  assert.equal(venueCatalog.filter((profile) => profile.type === "期刊").length, 45);
});

test("all seven overlapping venues keep legacy review IDs and other categories are untouched", () => {
  const merged = mergeVenueCatalog(demoKnowledgeRecords);
  const seeds = demoKnowledgeRecords.filter((record) => record.kind === "journal");
  for (const seed of seeds) {
    const record = merged.find((item) => item.id === seed.id)!;
    assert.ok(record.venue);
    assert.ok(findKnowledgeMatch(`论文发表于 ${seed.title}`, record));
    assert.ok(seed.aliases.every((alias) => record.aliases.includes(alias) || record.title === alias));
  }
  assert.deepEqual(merged.filter((record) => record.kind !== "journal"), demoKnowledgeRecords.filter((record) => record.kind !== "journal"));
  assert.equal(knowledgeRecords.filter((record) => record.kind === "journal").length, 100);
  assert.equal(knowledgeRecords.filter((record) => record.kind === "competition").length, 122);
  assert.equal(knowledgeRecords.filter((record) => record.kind === "company").length, 8);
  assert.equal(new Set(knowledgeRecords.map((record) => record.id)).size, 230);
});

test("venue references avoid generic skills and degree subjects while supporting publication names", () => {
  assert.deepEqual(findVenueBackground("技能：AI、CL、PR、NN、MM、SC、自然语言处理。\nEducation: BSc Computer Science"), []);
  assert.deepEqual(findVenueBackground("自然语言处理论文，研究方向：人工智能、模式识别、计算机科学。"), []);
  const background = findVenueBackground("论文发表于 NeurIPS 2023 Workshop，非主会。\n论文发表于《计算机学报》。");
  assert.equal(background.length, 2);
  const neurips = background.find((record) => record.id === "conf-neurips")!;
  assert.equal(neurips.rankings[0].year, 2026);
  assert.ok(neurips.rankings[0].applies_to.includes("Workshop"));
  assert.equal(neurips.checked_on, "2026-11-14");
  const science = knowledgeRecords.find((record) => record.venue?.id === "journal-science")!;
  assert.equal(findKnowledgeMatch("BSc Computer Science", science), null);
  assert.equal(findKnowledgeMatch("论文发表于 Science", science), "Science");
  assert.equal(findKnowledgeMatch("NeurIPSx", knowledgeRecords.find((record) => record.id === "journal-neurips")!), null);
});

test("rank systems, years, missing metrics and source reading methods remain independent", () => {
  const neurips = knowledgeRecords.find((record) => record.id === "journal-neurips")!;
  const cjc = knowledgeRecords.find((record) => record.venue?.id === "journal-cjc")!;
  assert.equal(neurips.venue!.rankings[0].rank, "A");
  assert.equal(cjc.venue!.rankings[0].rank, "T1");
  assert.notEqual(neurips.venue!.rankings[0].system, cjc.venue!.rankings[0].system);
  assert.ok(venueSearchText(cjc).includes("计算机学报"));
  assert.ok(venueSearchText(cjc).includes("2025 年版"));
  assert.ok(venueCatalog.every((profile) => profile.annual_metrics === null && profile.indexing === null));
  assert.ok(knowledgeRecords.filter((record) => record.venue).every((record) => !record.reviewHistory?.length && record.evidenceSources?.every((source) => !source.verified && !source.dataYear && !source.checkedAt)));
  assert.equal(venueCatalog.find((profile) => profile.id === "conf-prcv")!.sources[0].access, "检索缓存");
  assert.equal(venueCatalog.find((profile) => profile.id === "journal-nature")!.rankings.length, 0);
});

test("venue profile backups preserve all nested fields and reject unsafe or malformed metadata", () => {
  const record = { ...knowledgeRecords.find((item) => item.id === "journal-neurips")!, id: "custom-venue-backup" };
  const bundle = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [record] });
  assert.ok(!("error" in bundle));
  if (!("error" in bundle)) assert.deepEqual(bundle.records[0].venue, record.venue);
  const invalid = [
    { ...record.venue!, official_website: "javascript:alert(1)" },
    { ...record.venue!, sources: [{ ...record.venue!.sources[0], url: "file:///private" }] },
    { ...record.venue!, rankings: [{ ...record.venue!.rankings[0], source_url: "data:text/html,evil" }] },
    { ...record.venue!, rankings: [{ ...record.venue!.rankings[0], year: "2026" }] },
    { ...record.venue!, annual_metrics: 0 },
  ];
  for (const profile of invalid) assert.equal(normalizeVenueProfile(profile), undefined);
});
