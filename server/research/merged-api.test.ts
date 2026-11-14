import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scoreCriteria } from "../../shared/scoring.js";
import { readAnalysisEvents } from "../../src/analysis-stream.js";
import type { AnalysisEvent } from "../../src/research-types.js";

test("合并后的 PDF 分析核查成果、保存原有评分历史，并兼容流式和 JSON 响应", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bohack-merge-"));
  const metadata = path.join(directory, ".metadata", "merge-test.json");
  const ocrText = "2024 Merge test lab Merge test project Backend developer";
  const requests: Array<{ stream?: boolean; response_format?: unknown; tools?: unknown; messages: Array<{ content: string }> }> = [];
  let failScore = false;
  const model = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const input = JSON.parse(body) as (typeof requests)[number];
    requests.push(input);
    if (input.stream) {
      response.setHeader("Content-Type", "text/event-stream");
      response.write(`data: ${JSON.stringify({ id: "merge-test", object: "chat.completion.chunk", model: "test", created: 1, choices: [{ index: 0, finish_reason: null, delta: { content: "合并后的分析报告。" } }] })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    const result = input.response_format
      ? { criteria: Object.fromEntries(scoreCriteria.map(({ key }) => [key, { score: 80, evidence: ["Backend developer"], confidence: 0.8 }])) }
      : { items: [{ kind: "project", input: { project_name: "Merge test project", project_year: 2024, organization: "Merge test lab", role: "Backend developer" }, context: {}, evidence: ocrText }], notes: [] };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: failScore && input.response_format ? "invalid JSON" : JSON.stringify(result) } }] }));
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const modelAddress = model.address();
  assert.ok(modelAddress && typeof modelAddress !== "string");
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const appAddress = reservation.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  await mkdir(path.dirname(metadata), { recursive: true });
  await writeFile(metadata, JSON.stringify({
    id: "merge-test", source: "pdf", name: "合成候选人", role: "Backend developer", text: "Original PDF text",
    fileName: "merge-test.pdf", education: "", skills: [], received: "2026-11-14", analysisReport: "旧报告", scoreHistory: [],
  }), "utf8");
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, PORT: String(appAddress.port), RESUME_DIR: directory, OPENAI_API_KEY: "local-test", OPENAI_MODEL: "test", OPENAI_EXTRACTION_MODEL: "test", OPENAI_BASE_URL: `http://127.0.0.1:${modelAddress.port}/v1`, TAVILY_API_KEY: "", MODEL_REQUEST_TIMEOUT_MS: "3000", ANALYSIS_TIMEOUT_MS: "5000", AGENT_TIMEOUT_MS: "8000" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const baseUrl = `http://127.0.0.1:${appAddress.port}`;
  const post = (body: Record<string, unknown>) => fetch(`${baseUrl}/api/resumes/merge-test/analyze`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleRequirements: "Backend developer", question: "分析经历", ocrText, ...body }),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`API startup timeout: ${stderr}`)), 10_000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("Agent API listening")) { clearTimeout(timeout); resolve(); } });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error(stderr || "API exited during startup")); });
    });
    for (const endpoint of ["scoring/weights", "history", "knowledge"]) {
      assert.equal((await fetch(`${baseUrl}/api/resumes/${endpoint}`)).status, 200);
    }
    assert.equal((await post({ includeResearch: "yes" })).status, 400);
    const events: AnalysisEvent[] = [];
    const response = await post({ includeResearch: true, streamProgress: true, webResearchEnabled: true });
    assert.match(response.headers.get("Content-Type") ?? "", /application\/x-ndjson/);
    await readAnalysisEvents(response, (event) => events.push(event));
    const completed = events.find((event) => event.type === "complete");
    assert.ok(completed?.type === "complete");
    assert.equal(completed.research.items[0].item.input.project_name, "Merge test project");
    assert.equal(completed.research.items[0].status, "pending");
    assert.equal(completed.researchStatus, "not-configured");
    assert.equal(completed.resume?.scoreCard?.formula, "weighted-mean-v1");
    assert.equal(completed.resume?.scoreCard?.composite, 80);
    assert.equal(completed.resume?.scoreHistory?.length, 1);
    assert.ok(events.some((event) => event.type === "research"));
    assert.ok(events.some((event) => event.type === "answer"));
    assert.ok(requests.some((input) => input.stream && JSON.stringify(input.messages).includes("Merge test project")));
    assert.ok(requests.filter((input) => input.stream).every((input) => !input.tools));
    let saved = JSON.parse(await readFile(metadata, "utf8"));
    assert.equal(saved.text, "Original PDF text");
    assert.equal(saved.analysisReport, "合并后的分析报告。");
    assert.equal(saved.scoreHistory.length, 1);

    const previousCount = requests.length;
    const jsonResponse = await post({ includeResearch: false });
    const result = await jsonResponse.json();
    assert.equal(jsonResponse.status, 200);
    assert.deepEqual(result.research.items, []);
    assert.equal(result.resume.scoreHistory.length, 2);
    assert.equal(requests.length - previousCount, 2, "关闭成果核查后只请求报告和原有评分卡。");

    saved = JSON.parse(await readFile(metadata, "utf8"));
    failScore = true;
    const failed: AnalysisEvent[] = [];
    await assert.rejects(readAnalysisEvents(await post({ includeResearch: false, streamProgress: true }), (event) => failed.push(event)));
    assert.equal(failed.at(-1)?.type, "error");
    assert.ok(!failed.some((event) => event.type === "complete"));
    assert.deepEqual(JSON.parse(await readFile(metadata, "utf8")), saved, "任一生成失败时不保存半套新报告或评分。");
  } finally {
    child.kill();
    await new Promise<void>((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve()));
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
