import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createAssessment } from "./pipeline.js";
import { sampleMaterial } from "../../shared/scoring-samples.js";
import { materialLibraryStore } from "../material-library-store.js";
import { type KnowledgeRecord } from "../../shared/knowledge.js";

test("材料资料库保存每项材料分及每个能力维度的实际贡献", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".data-material-library-test-"));
  const originalFile = materialLibraryStore.file;
  const originalDirectory = materialLibraryStore.metadataDirectory;
  Object.defineProperty(materialLibraryStore, "file", { value: path.join(directory, "material-library.json"), configurable: true });
  Object.defineProperty(materialLibraryStore, "metadataDirectory", { value: directory, configurable: true });
  const record = { id: "competition-test", kind: "competition", title: "合成算法竞赛", aliases: ["合成赛"], field: "算法", organizer: "合成组委会", region: "中国", summary: "合成资料", signals: [], officialUrl: "", significanceScore: 50, scoreRationale: "", verificationStatus: "示例资料，待核验", updatedAt: "" } satisfies KnowledgeRecord;
  try {
    const material = sampleMaterial("award", "合成算法竞赛", "合成算法竞赛一等奖，我负责开发求解器并完成交付。", { tier: "first", judging: "specified" });
    const assessment = createAssessment(material.resume_claim, [material]);
    await materialLibraryStore.save({ id: "candidate-1", name: "候选人甲", source: "pdf", assessment, assessmentHistory: [{ reason: "review", assessment }] }, [record]);
    const entries = await materialLibraryStore.list([record]);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].knowledgeIds, [record.id]);
    assert.equal(entries[0].materialScore, assessment.materials[0].material_score);
    assert.ok(Object.hasOwn(entries[0].abilityContributions, "professional_execution"));
    assert.equal((JSON.parse(await readFile(path.join(directory, "material-library.json"), "utf8")) as { candidates: Record<string, unknown> }).candidates["candidate-1"] !== undefined, true);
  } finally {
    Object.defineProperty(materialLibraryStore, "file", { value: originalFile, configurable: true });
    Object.defineProperty(materialLibraryStore, "metadataDirectory", { value: originalDirectory, configurable: true });
    await rm(directory, { recursive: true, force: true });
  }
});
