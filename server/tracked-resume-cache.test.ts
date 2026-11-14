import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTrackedResumeReport, saveTrackedResumeReport } from "./tracked-resume-cache.js";

test("tracked PDF reports persist and restore only when the resume matches the Git manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-tracked-report-"));
  const source = path.join(directory, "tracked-resumes");
  const cache = path.join(directory, "tracked-reports");
  const runtime = path.join(directory, "runtime");
  const originalSource = process.env.TRACKED_RESUME_DIR;
  const originalCache = process.env.TRACKED_RESUME_CACHE_DIR;
  const pdf = Buffer.from("%PDF-test content");
  const digest = createHash("sha256").update(pdf).digest("hex");
  await mkdir(source, { recursive: true });
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(source, "resume-1.pdf"), pdf);
  await writeFile(path.join(runtime, "resume-1.pdf"), pdf);
  await writeFile(path.join(source, "manifest.json"), JSON.stringify({ files: [{ file: "resume-1.pdf", sha256: digest }] }));
  process.env.TRACKED_RESUME_DIR = source;
  process.env.TRACKED_RESUME_CACHE_DIR = cache;
  const record = {
    id: "resume-1", fileName: "resume-1.pdf", analysisReport: "已生成报告", analysisStatus: "complete" as const,
    analysisError: "", analyzedAt: "2026-11-14T10:00:00.000Z", assessment: { score: 82 },
    assessmentHistory: [{ score: 82 }], agentArtifacts: [{ id: "score-calculation" }],
  };
  try {
    assert.equal(await saveTrackedResumeReport(record, path.join(runtime, "resume-1.pdf")), true);
    const cacheRecord = JSON.parse(await readFile(path.join(cache, "resume-1.json"), "utf8"));
    assert.equal(cacheRecord.resumeSha256, digest);
    const stale = { ...record, analysisReport: "", analysisStatus: "unavailable" as const, analyzedAt: "" };
    const restored = await loadTrackedResumeReport(stale, path.join(runtime, "resume-1.pdf"));
    assert.equal(restored.analysisReport, record.analysisReport);
    assert.deepEqual(restored.assessment, record.assessment);
    assert.deepEqual(restored.agentArtifacts, record.agentArtifacts);
    await writeFile(path.join(runtime, "resume-1.pdf"), "different PDF");
    assert.equal(await saveTrackedResumeReport(record, path.join(runtime, "resume-1.pdf")), false);
    assert.equal((await loadTrackedResumeReport(stale, path.join(runtime, "resume-1.pdf"))).analysisReport, "");
    const privateRecord = { ...record, id: "private-1", fileName: "private-1.pdf" };
    await writeFile(path.join(runtime, "private-1.pdf"), pdf);
    assert.equal(await saveTrackedResumeReport(privateRecord, path.join(runtime, "private-1.pdf")), false);
  } finally {
    if (originalSource === undefined) delete process.env.TRACKED_RESUME_DIR; else process.env.TRACKED_RESUME_DIR = originalSource;
    if (originalCache === undefined) delete process.env.TRACKED_RESUME_CACHE_DIR; else process.env.TRACKED_RESUME_CACHE_DIR = originalCache;
    await rm(directory, { recursive: true, force: true });
  }
});
