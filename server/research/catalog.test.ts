import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { KnowledgeCatalogStore } from "../knowledge-store.js";
import { enrichCatalog, catalogRecord } from "./catalog.js";
import { validateExtraction } from "./extract.js";
import { enrichResume, skillInput } from "./runner.js";
import { ResearchStore } from "./store.js";
import { loadSkill } from "./config.js";
import type { CatalogCandidate, ResearchItem, ResearchReport } from "../../src/research-types.js";

const url = "https://example.org/venue";
const profile = {
  confirmed: true,
  aliases: ["UVC"],
  profile: {
    name: "Unknown Vision Conference", abbreviation: "UVC", type: "会议", scope: "国际学术会议",
    field: ["计算机视觉"], publisher_or_organizer: "Unknown Society", official_website: url,
    short_info: "视觉研究交流会议。", info: "面向视觉研究的公共学术会议。", influence: "尚未核实。", difficulty: "尚未核实。",
    rankings: [], ranking_note: "暂无已读取分级。", annual_metrics: null, indexing: null, checked_on: "2026-11-14",
    sources: [{ title: "会议官网", url, information: "官网正文支持会议名称和组织背景。", access: "全文读取", source_type: "官方" }], notes: ["需核对具体论文轨道。"],
  },
};

test("unknown venue becomes a durable standard catalog record and deduplicates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-catalog-store-"));
  try {
    const store = new KnowledgeCatalogStore(directory);
    const record = catalogRecord(profile, { kind: "journal", name: "Unknown Vision Conference", evidence: "发表在 UVC" }, new Set([url]));
    const first = await store.put(record, [], new AbortController().signal);
    assert.equal(first.created, true);
    assert.match(first.record.id, /^custom-auto-journal-[a-f0-9]{32}$/);
    assert.equal((await store.list()).length, 1);
    const second = await store.put(record, [], new AbortController().signal);
    assert.equal(second.created, false);
    assert.equal(second.record.id, first.record.id);
    const saved = JSON.parse(await readFile(path.join(directory, `${first.record.id}.json`), "utf8"));
    assert.equal(saved.origin.type, "discovered");
    const results = await enrichCatalog([{ kind: "journal", name: "Unknown Vision Conference", evidence: "UVC" }], { store, records: [], canSearch: false });
    assert.deepEqual(results[0].status, "existing");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unknown catalog entry rejects a source that was only a search snippet", () => {
  assert.throws(() => catalogRecord(profile, { kind: "journal", name: "Unknown Vision Conference", evidence: "UVC" }, new Set()), /未读来源/);
});

const competition = {
  confirmed: true, aliases: ["未知算法赛"], profile: {
    name: "未知算法挑战赛", category: "算法", official_website: url, organizer: "算法研究协会",
    short_info: "算法实践竞赛。", info: "通过算法题目考查解题能力的赛事。", influence: "未核实。", difficulty: "未核实。",
    acquires: ["算法分析"], projection: ["问题求解"], sources: [{ title: "官方章程", url }], notes: "公共背景，个人获奖待核验。",
  },
};
const candidate: CatalogCandidate = { kind: "journal", name: "Unknown Vision Conference", evidence: "" };
const makeRecord = async (entry: CatalogCandidate) => catalogRecord(entry.kind === "journal" ? profile : competition, entry, new Set([url]));

test("extracts venue without a paper title and competition without an award year, rejecting invented names", () => {
  const text = "参与未知算法挑战赛。论文发表于 Unknown Vision Conference。";
  const extracted = validateExtraction({ items: [], catalogCandidates: [
    { kind: "competition", name: "未知算法挑战赛", evidence: "参与未知算法挑战赛。" },
    { kind: "journal", name: "Unknown Vision Conference", evidence: "论文发表于 Unknown Vision Conference。" },
    { kind: "journal", name: "Fabricated Journal", evidence: "论文发表于 Unknown Vision Conference。" },
  ] }, text);
  assert.equal(extracted.catalogCandidates?.length, 2);
  assert.ok(extracted.notes.some((note) => note.includes("原文依据")));
});

test("enrichment persists both standard profiles even when there is no individual achievement report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-auto-enrich-"));
  try {
    const researchStore = new ResearchStore(directory);
    let researchCalls = 0;
    const candidates: CatalogCandidate[] = [{ kind: "competition", name: "未知算法挑战赛", evidence: "" }, candidate];
    const run = () => enrichResume("synthetic resume", {
      store: researchStore, canSearch: true, extract: async () => ({ items: [], notes: [], catalogCandidates: candidates }),
      catalogResearch: async (entry) => { researchCalls++; return makeRecord(entry); },
    });
    const first = await run();
    assert.deepEqual(first.catalog?.map((entry) => entry.status), ["created", "created"]);
    assert.equal(first.items.length, 0);
    const store = new KnowledgeCatalogStore(path.join(directory, "library"));
    const saved = await store.list();
    assert.equal(saved.length, 2);
    assert.ok(saved.find((record) => record.kind === "competition")?.competition?.acquires.includes("算法分析"));
    assert.ok(saved.find((record) => record.kind === "journal")?.venue?.sources[0].information);
    assert.ok(saved.every((record) => !record.reviewHistory && record.verificationStatus !== "已核验"));
    const second = await run();
    assert.equal(researchCalls, 2, "existing standard records must not be researched again");
    assert.deepEqual(second.catalog?.map((entry) => entry.status), ["existing", "existing"]);
    assert.equal((await store.list()).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unknown publication channel discovered in a cached paper report is promoted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-paper-promote-"));
  try {
    const entry: ResearchItem = { kind: "paper", input: { title: "Synthetic Paper", description: null }, context: {}, evidence: "Synthetic Paper", missingFields: [], notes: [] };
    const report = structuredClone(loadSkill("paper").template) as ResearchReport;
    report.input = skillInput(entry);
    (report.paper as Record<string, unknown>).official_title = "Synthetic Paper";
    (report.publication as Record<string, unknown>).venue_name = candidate.name;
    report.sources = [{ title: "Paper record", url, information: "Public paper and venue record." }];
    const store = new ResearchStore(directory);
    await store.put(entry, report, true);
    const batch = await enrichResume("Synthetic Paper", { store, canSearch: true, extract: async () => ({ items: [entry], notes: [] }), catalogResearch: makeRecord });
    assert.equal(batch.items[0].status, "cached");
    assert.equal(batch.catalog?.[0].status, "created");
    assert.equal((await new KnowledgeCatalogStore(path.join(directory, "library")).list()).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("concurrent unknown names and different aliases resolve to one standard identity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-auto-concurrent-"));
  try {
    const store = new KnowledgeCatalogStore(directory);
    let calls = 0;
    const research = async (entry: CatalogCandidate) => { calls++; await new Promise((resolve) => setTimeout(resolve, 25)); return makeRecord(entry); };
    const outputs = await Promise.all(Array.from({ length: 3 }, () => enrichCatalog([candidate], { store, records: [], canSearch: true, research })));
    assert.equal(calls, 1);
    assert.ok(outputs.every((entries) => entries[0].knowledgeId === outputs[0][0].knowledgeId));
    assert.equal((await store.list()).length, 1);
    const alias = await enrichCatalog([{ ...candidate, name: "UVC" }], { store, records: [], canSearch: false });
    assert.equal(alias[0].status, "existing");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cancellation blocks late catalog writes and unread/unknown profiles stay pending", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-auto-cancel-"));
  try {
    const store = new KnowledgeCatalogStore(directory);
    const controller = new AbortController();
    const operation = enrichCatalog([candidate], { store, records: [], canSearch: true, signal: controller.signal,
      research: async () => { await new Promise((resolve) => setTimeout(resolve, 45)); return makeRecord(candidate); },
    });
    setTimeout(() => controller.abort(new Error("cancelled")), 15);
    assert.equal((await operation)[0].status, "error");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal((await store.list()).length, 0);
    assert.equal((await enrichCatalog([candidate], { store, records: [], canSearch: false }))[0].status, "pending");
    assert.throws(() => catalogRecord({ ...profile, confirmed: false }, candidate, new Set([url])), /确认主体/);
    assert.throws(() => catalogRecord({ ...profile, profile: { ...profile.profile, rankings: [{ system: "CCF", issuer: "CCF", edition: "2026", year: 2026, category: "AI", rank: "A", applies_to: "主会", source_url: "https://example.org/unread", verification: "source" }] } }, candidate, new Set([url])), /分级来源/);
    assert.equal((await readdir(directory)).filter((file) => file.endsWith(".json")).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("damaged catalog data is reported instead of overwritten", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-auto-damage-"));
  try {
    const store = new KnowledgeCatalogStore(directory);
    const saved = await store.put(await makeRecord(candidate), []);
    const file = path.join(directory, `${saved.record.id}.json`);
    await writeFile(file, "broken", "utf8");
    await assert.rejects(store.list());
    await assert.rejects(store.put(await makeRecord(candidate), []));
    assert.equal(await readFile(file, "utf8"), "broken");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
