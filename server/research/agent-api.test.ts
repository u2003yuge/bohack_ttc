import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readAnalysisEvents } from "../../src/analysis-stream.js";
import type { AnalysisEvent } from "../../src/research-types.js";

test("分析接口立即推送进度，兼容 JSON，超时和客户端取消会结束模型请求", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "bohack-report-api-"));
  const resumes = path.join(data, "resumes");
  const reports = path.join(data, "reports");
  await mkdir(path.join(resumes, ".metadata"), { recursive: true });
  const fixture = { id: "1", fileName: "1.pdf", name: "合成测试", text: "示例简历", role: "工程师", location: "",
    received: "", initials: "ST", source: "pdf", education: "", skills: [], summary: "", analysisReport: "",
    analysisStatus: "unavailable", analysisError: "", analyzedAt: "", pages: 1, size: 20, extractionVersion: 3 };
  await writeFile(path.join(resumes, ".metadata/1.json"), JSON.stringify(fixture));
  await writeFile(path.join(resumes, "1.pdf"), "%PDF-synthetic-listing-fixture");
  let mode: "delay" | "normal" | "hang" = "delay";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let modelStarted!: () => void;
  let modelReady = new Promise<void>((resolve) => { modelStarted = resolve; });
  let aborted = 0;
  const model = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain request */ }
    response.once("close", () => { if (!response.writableEnded) aborted += 1; });
    modelStarted();
    if (mode === "hang") return;
    if (mode === "delay") await gate;
    if (response.destroyed) return;
    response.setHeader("Content-Type", "text/event-stream");
    for (const content of ["分析", "已完成。"]) response.write(`data: ${JSON.stringify({ id: "local-test", object: "chat.completion.chunk", model: "test", created: 1, choices: [{ index: 0, finish_reason: null, delta: { content } }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const modelAddress = model.address();
  assert.ok(modelAddress && typeof modelAddress !== "string");
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const appAddress = reservation.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, RESUME_DIR: resumes, REPORT_DIR: reports, KNOWLEDGE_DB_DIR: path.join(data, "library"), PORT: String(appAddress.port), OPENAI_API_KEY: "local-test", OPENAI_BASE_URL: `http://127.0.0.1:${modelAddress.port}/v1`, TAVILY_API_KEY: "", MODEL_REQUEST_TIMEOUT_MS: "3000", ANALYSIS_TIMEOUT_MS: "600", AGENT_TIMEOUT_MS: "5000" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const post = (streamProgress = true, signal?: AbortSignal) => fetch(`http://127.0.0.1:${appAddress.port}/api/agent`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ resumeId: "1", resumeText: "示例简历", question: "分析经历", includeResearch: false, streamProgress }),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`API startup timeout: ${stderr}`)), 10000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("Agent API listening")) { clearTimeout(timeout); resolve(); } });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error(stderr || "API exited during startup")); });
    });
    const response = await post();
    assert.ok(response.headers.get("Content-Type")?.includes("application/x-ndjson"));
    const events: AnalysisEvent[] = [];
    let progressReceived!: () => void;
    const progress = new Promise<void>((resolve) => { progressReceived = resolve; });
    const reading = readAnalysisEvents(response, (event) => { events.push(event); if (event.type === "progress") progressReceived(); });
    await progress;
    assert.ok(!events.some((event) => event.type === "complete"));
    await modelReady;
    release();
    await reading;
    assert.equal(events.at(-1)?.type, "complete");
    assert.ok(events.some((event) => event.type === "answer" && event.text === "分析"));
    const completed = events.at(-1);
    assert.ok(completed?.type === "complete" && completed.resume?.analysisReport === "分析已完成。");
    const firstFiles = await readdir(path.join(reports, "1"));
    assert.equal(firstFiles.length, 1);
    const saved = JSON.parse(await readFile(path.join(reports, "1", firstFiles[0]), "utf8"));
    assert.equal(saved.answer, "分析已完成。");
    assert.equal(saved.question, "分析经历");
    assert.equal(saved.kind, "agent");
    assert.ok(!("resumeText" in saved));
    const listing = await (await fetch(`http://127.0.0.1:${appAddress.port}/api/resumes`)).json();
    assert.equal(listing.resumes[0].analysisReport, "分析已完成。");
    assert.equal(JSON.parse(await readFile(path.join(resumes, ".metadata/1.json"), "utf8")).analysisStatus, "complete");

    mode = "normal";
    const jsonResponse = await post(false);
    assert.equal((await jsonResponse.json()).answer, "分析已完成。");
    assert.equal((await readdir(path.join(reports, "1"))).length, 2, "Repeated analysis retains both reports");

    mode = "hang";
    await assert.rejects(readAnalysisEvents(await post(), () => {}), /模型分析超时/);
    assert.ok(aborted >= 1);

    modelReady = new Promise<void>((resolve) => { modelStarted = resolve; });
    const controller = new AbortController();
    const canceledResponse = await post(true, controller.signal);
    const canceledRead = readAnalysisEvents(canceledResponse, () => {}).catch((error: unknown) => error);
    await modelReady;
    const beforeCancel = aborted;
    controller.abort();
    assert.ok(await canceledRead instanceof Error);
    const limit = Date.now() + 2000;
    while (aborted === beforeCancel && Date.now() < limit) await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.ok(aborted > beforeCancel, "Cancel should close the outstanding model request.");
    assert.equal((await readdir(path.join(reports, "1"))).length, 2, "Timeouts and cancellation must not archive a successful report");
  } finally {
    child.kill();
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", resolve));
    await rm(data, { recursive: true, force: true });
  }
});
