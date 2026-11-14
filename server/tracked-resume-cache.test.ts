import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTrackedResumeReport, saveTrackedResumeReport } from "./tracked-resume-cache.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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
    assert.equal(await saveTrackedResumeReport({ ...record, analysisStatus: "processing" }, path.join(runtime, "resume-1.pdf")), false);
    assert.equal(await readFile(path.join(cache, "resume-1.json"), "utf8"), JSON.stringify(cacheRecord, null, 2) + "\n");
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

test("automatic seeding preserves changed runtime PDFs while manual seeding still rejects conflicts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bohack-seed-preserve-"));
  const project = fileURLToPath(new URL("../", import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(project, "dev-data/mock-resumes/manifest.json"), "utf8")) as {
    files: Array<{ file: string; sha256: string }>;
  };
  const first = manifest.files[0];
  const content = Buffer.from("%PDF-local developer copy");
  const run = promisify(execFile);
  try {
    await writeFile(path.join(directory, first.file), content);
    await assert.rejects(run(process.execPath, ["scripts/seed-mock-resumes.mjs", directory], { cwd: project, windowsHide: true }), /目标目录已有不同内容/);
    const seeded = await run(process.execPath, ["scripts/seed-mock-resumes.mjs", directory, "--keep-existing"], { cwd: project, windowsHide: true });
    const result = JSON.parse(seeded.stdout);
    assert.equal(result.preserved, 1);
    assert.equal(result.copied, manifest.files.length - 1);
    assert.deepEqual(await readFile(path.join(directory, first.file)), content);
    for (const entry of manifest.files.slice(1)) {
      assert.equal(createHash("sha256").update(await readFile(path.join(directory, entry.file))).digest("hex"), entry.sha256);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
