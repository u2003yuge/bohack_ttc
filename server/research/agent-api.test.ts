import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readAnalysisEvents } from "../../src/analysis-stream.js";
import type { AnalysisEvent } from "../../src/research-types.js";

test("分析接口立即推送进度，兼容 JSON，超时和客户端取消会结束模型请求", async () => {
  let mode: "delay" | "normal" | "hang" = "delay";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let modelStarted!: () => void;
  let modelReady = new Promise<void>((resolve) => { modelStarted = resolve; });
  let aborted = 0;
  const model = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    if (JSON.parse(body).response_format) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [], notes: [] }) } }] }));
      return;
    }
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
    env: { ...process.env, PORT: String(appAddress.port), OPENAI_API_KEY: "local-test", OPENAI_BASE_URL: `http://127.0.0.1:${modelAddress.port}/v1`, TAVILY_API_KEY: "", MODEL_REQUEST_TIMEOUT_MS: "3000", ANALYSIS_TIMEOUT_MS: "600", AGENT_TIMEOUT_MS: "5000" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const post = (streamProgress = true, signal?: AbortSignal) => fetch(`http://127.0.0.1:${appAddress.port}/api/agent`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ resumeText: "示例简历", question: "分析经历", includeResearch: false, streamProgress }),
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

    mode = "normal";
    const jsonResponse = await post(false);
    assert.equal((await jsonResponse.json()).answer, "分析已完成。");

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
  } finally {
    child.kill();
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
  }
});
