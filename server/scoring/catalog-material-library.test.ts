import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createAssessment } from "./pipeline.js";
import { sampleMaterial } from "../../shared/scoring-samples.js";
import { materialLibraryStore } from "../material-library-store.js";
import type { KnowledgeRecord } from "../../shared/knowledge.js";

test("catalog background scores use an isolated candidate and keep ability contributions unknown", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".data-material-library-catalog-test-"));
  const originalFile = materialLibraryStore.file;
  const originalDirectory = materialLibraryStore.metadataDirectory;
  Object.defineProperty(materialLibraryStore, "file", { value: path.join(directory, "material-library.json"), configurable: true });
  Object.defineProperty(materialLibraryStore, "metadataDirectory", { value: directory, configurable: true });
  const record = {
    id: "catalog-record",
    kind: "competition",
    title: "资料库合成赛事",
    aliases: [],
    field: "工程",
    organizer: "组委会",
    region: "中国",
    summary: "有明确评审规则的赛事",
    signals: [],
    officialUrl: "",
    significanceScore: 50,
    scoreRationale: "",
    verificationStatus: "示例资料，待核验",
    updatedAt: "",
  } satisfies KnowledgeRecord;
  try {
    const material = sampleMaterial("award", record.title, "资料库合成赛事有明确评审规则。", { judging: "specified" });
    const assessment = createAssessment("资料库背景", [material]);
    await materialLibraryStore.saveCatalog(assessment, [record]);
    const entries = await materialLibraryStore.list([record]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].candidateId, "__catalog__");
    assert.equal(entries[0].candidateName, "资料库背景");
    assert.equal(entries[0].knowledgeIds[0], record.id);
    assert.ok(Object.values(entries[0].abilityContributions).every((item) => item.contribution === null));
  } finally {
    Object.defineProperty(materialLibraryStore, "file", { value: originalFile, configurable: true });
    Object.defineProperty(materialLibraryStore, "metadataDirectory", { value: originalDirectory, configurable: true });
    await rm(directory, { recursive: true, force: true });
  }
});
