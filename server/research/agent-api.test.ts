import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readAnalysisEvents } from "../../src/analysis-stream.js";
import type { AnalysisEvent } from "../../src/research-types.js";

test("分析接口立即推送进度，兼容 JSON，超时和客户端取消会结束模型请求", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bohack-agent-reports-"));
  let mode: "delay" | "normal" | "hang" = "delay";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let modelStarted!: () => void;
  let modelReady = new Promise<void>((resolve) => { modelStarted = resolve; });
  let aborted = 0;
  const model = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const input = JSON.parse(body);
    if (input.response_format) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [], notes: [], materials: [] }) } }] }));
      return;
    }
    response.once("close", () => { if (!response.writableEnded) aborted += 1; });
    modelStarted();
    if (mode === "hang") return;
    if (mode === "delay") await gate;
    if (response.destroyed) return;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: "分析已完成。" } }] }));
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
    env: { ...process.env, REPORT_DIR: directory, PORT: String(appAddress.port), OPENAI_API_KEY: "local-test", OPENAI_BASE_URL: `http://127.0.0.1:${modelAddress.port}/v1`, TAVILY_API_KEY: "local-test", MODEL_REQUEST_TIMEOUT_MS: "3000", ANALYSIS_TIMEOUT_MS: "600", AGENT_TIMEOUT_MS: "5000" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const post = (streamProgress = true, signal?: AbortSignal) => fetch(`http://127.0.0.1:${appAddress.port}/api/agent`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ resumeText: "示例简历", question: "分析经历", streamProgress }),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`API startup timeout: ${stderr}`)), 10000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("Agent API listening")) { clearTimeout(timeout); resolve(); } });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error(stderr || "API exited during startup")); });
    });
    const health = await fetch(`http://127.0.0.1:${appAddress.port}/api/health`).then((response) => response.json()) as { webSearch: boolean };
    assert.equal(health.webSearch, true);
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
    assert.ok(events.some((event) => event.type === "agent" && event.agentId === "analysis-report"));

    mode = "normal";
    const jsonResponse = await post(false);
    assert.match((await jsonResponse.json()).answer, /分析已完成/);
    const reportFiles = await readdir(directory, { recursive: true });
    assert.equal(reportFiles.filter((file) => file.endsWith(".json")).length, 2);

    mode = "hang";
    await assert.rejects(readAnalysisEvents(await post(), () => {}), /时限|超时/);
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
    assert.deepEqual(await readdir(directory, { recursive: true }), reportFiles);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve()));
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
