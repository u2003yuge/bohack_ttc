import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { saveAnalysisReport } from "../report-store.js";

test("report archives preserve initial/role history, isolate unsafe IDs and never save cancelled or empty reports", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bohack-reports-"));
  try {
    const base = { resumeId: "160", resumeName: "合成简历", resumeText: "原文", answer: "第一份分析" };
    await saveAnalysisReport({ ...base, kind: "initial" }, { directory });
    await saveAnalysisReport({ ...base, kind: "role", answer: "第二份分析", question: "核对要求", roleRequirements: "测试岗位" }, { directory });
    const files = await readdir(path.join(directory, "160"));
    assert.equal(files.length, 2);
    const history = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(directory, "160", file), "utf8"))));
    assert.deepEqual(history.map((report) => report.kind).sort(), ["initial", "role"]);
    assert.ok(history.every((report) => report.resumeSha256 && !("resumeText" in report)));
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await assert.rejects(saveAnalysisReport({ ...base, kind: "agent" }, { directory, signal: controller.signal }), /cancelled/);
    await assert.rejects(saveAnalysisReport({ ...base, kind: "agent", answer: " " }, { directory }), /空分析报告/);
    assert.equal((await readdir(path.join(directory, "160"))).length, 2);
    await saveAnalysisReport({ ...base, resumeId: "../../outside", kind: "agent" }, { directory });
    assert.ok((await readdir(directory)).every((folder) => folder === "160" || /^resume-[a-f0-9]{32}$/.test(folder)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
