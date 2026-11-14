import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scoringVersion } from "../../shared/material-scoring.js";
import { defaultScoreWeights, scoreCriteria } from "../../shared/scoring.js";
import { readAnalysisEvents } from "../../src/analysis-stream.js";
import type { AnalysisEvent } from "../../src/research-types.js";

test("PDF 分析复用一次材料提取、保存 v1 评分历史，并兼容流式和 JSON 响应", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bohack-merge-"));
  const metadata = path.join(directory, ".metadata", "merge-test.json");
  const ocrText = "2024 Merge test lab Merge test project Backend developer";
  const requests: Array<{ stream?: boolean; response_format?: unknown; tools?: unknown; messages: Array<{ content: string }> }> = [];
  let failReport = false;
  let hangReport = false;
  let reportStarted: (() => void) | undefined;
  let canceledReports = 0;
  const model = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const input = JSON.parse(body) as (typeof requests)[number];
    requests.push(input);
    if (!input.response_format) {
      if (hangReport) { reportStarted?.(); response.once("close", () => { if (!response.writableEnded) canceledReports += 1; }); return; }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: failReport ? "" : "合并后的分析报告。" } }] }));
      return;
    }
    const result = {
      name: "合成候选人", role: "Backend developer", location: "", education: "", skills: [], summary: "",
      items: [{ material_type: "project", title: "Merge test project", year: 2024, organization: "Merge test lab", role: "Backend developer", personal_actions: [], resume_claim: ocrText }],
      projects: [{ sourceIndex: 0, plainTitle: "搭建项目服务", goal: "建设服务", actions: "搭建服务", outcome: "完成服务", evidence: "Merge test project" }],
      notes: [],
    };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
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
  const compatibilityCard = { formula: "weighted-mean-v1", composite: 77, criteria: Object.fromEntries(scoreCriteria.map(({ key }) => [key, { score: 77, evidence: ["历史材料"], confidence: .6 }])), weights: defaultScoreWeights, evaluatedAt: "2026-01-01T00:00:00.000Z", overallConfidence: .6 };
  await writeFile(metadata, JSON.stringify({
    id: "merge-test", source: "pdf", name: "合成候选人", role: "Backend developer", text: "Original PDF text",
    fileName: "merge-test.pdf", education: "", skills: [], received: "2026-11-14", analysisReport: "历史报告", scoreHistory: [], scoreCard: compatibilityCard,
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
    const response = await post({ streamProgress: true });
    assert.match(response.headers.get("Content-Type") ?? "", /application\/x-ndjson/);
    await readAnalysisEvents(response, (event) => events.push(event));
    const completed = events.find((event) => event.type === "complete");
    assert.ok(completed?.type === "complete");
    assert.deepEqual(completed.research.items, []);
    assert.equal(completed.researchStatus, "not-requested");
    assert.equal(completed.resume?.assessment?.version, scoringVersion);
    assert.equal(completed.resume?.assessment?.abilities.professional_execution.score, null);
    assert.equal(completed.resume?.assessmentHistory?.length, 1);
    assert.deepEqual(completed.resume?.scoreCard, compatibilityCard);
    assert.ok(events.some((event) => event.type === "agent" && event.agentId === "score-calculation"));
    assert.ok(events.some((event) => event.type === "agent" && event.agentId === "analysis-report"));
    assert.ok(requests.some((input) => JSON.stringify(input.messages).includes("Merge test project")));
    let saved = JSON.parse(await readFile(metadata, "utf8"));
    assert.equal(saved.text, "Original PDF text");
    assert.match(saved.analysisReport, /### 综合分析\n\n合并后的分析报告。/);
    assert.equal(saved.assessmentHistory.length, 1);
    assert.equal(saved.scoreHistory.length, 0);

    const previousCount = requests.length;
    const jsonResponse = await post({});
    const result = await jsonResponse.json();
    assert.equal(jsonResponse.status, 200);
    assert.deepEqual(result.research.items, []);
    assert.equal(result.resume.assessmentHistory.length, 2);
    assert.ok(requests.length - previousCount >= 0, "规则评分不应触发成果核查请求。");

    saved = JSON.parse(await readFile(metadata, "utf8"));
    failReport = true;
    const failed: AnalysisEvent[] = [];
    await readAnalysisEvents(await post({ streamProgress: true }), (event) => failed.push(event));
    assert.ok(failed.some((event) => event.type === "complete"), "已有 Agent 缓存可复用，报告仍应完成。");

    const scoreOnly = await fetch(`${baseUrl}/api/resumes/merge-test/assessment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useModel: false, ocrText: "合成项目：我独立负责开发服务，完成上线交付。" }) });
    assert.equal(scoreOnly.status, 200);
    const scored = await scoreOnly.json();
    assert.equal(scored.resume.assessmentHistory.length, 4);
    assert.equal(scored.resume.text, "Original PDF text");
    assert.ok((scored.assessment.abilities.professional_execution.score ?? 0) >= 0);
    assert.equal(scored.assessment.version, scoringVersion);
    const rules = await (await fetch(`${baseUrl}/api/scoring/rules`)).json();
    assert.equal(rules.version, scoringVersion);
    assert.equal(rules.abilities.length, 5);
    const offline = await fetch(`${baseUrl}/api/scoring/evaluate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "项目：负责开发测试模块并交付。", useModel: false }) });
    assert.equal(offline.status, 200);
    assert.equal((await offline.json()).assessment.extraction, "rules");
    const preference = { title: "合成执行岗", weights: { professional_execution: 1, problem_solving: 0, ownership_delivery: 0, collaboration_organization: 0, learning_research: 0 }, must_have: ["Python"] };
    const save = await fetch(`${baseUrl}/api/scoring/jobs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preference) });
    assert.equal(save.status, 200);
    const jobs = await (await fetch(`${baseUrl}/api/scoring/jobs`)).json();
    assert.equal(jobs.jobs[0].title, "合成执行岗");
    assert.equal(jobs.jobs[0].weights.professional_execution, 1);
    assert.deepEqual(JSON.parse(await readFile(metadata, "utf8")), scored.resume, "保存岗位偏好不修改候选人基础分。");
    const concurrent = await Promise.all([0, 1].map(() => fetch(`${baseUrl}/api/resumes/merge-test/assessment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useModel: false, ocrText: "合成项目：我负责开发接口并完成交付。" }) })));
    assert.ok(concurrent.every((result) => result.status === 200));
    saved = JSON.parse(await readFile(metadata, "utf8"));
    assert.equal(saved.assessmentHistory.length, 6, "并发复评不能丢失历史记录。");
    assert.equal(new Set(saved.assessmentHistory.map((entry: { assessment: { id: string } }) => entry.assessment.id)).size, 6);
    assert.deepEqual(saved.scoreCard, compatibilityCard);

    failReport = false; hangReport = true;
    const ready = new Promise<void>((resolve) => { reportStarted = resolve; });
    const abort = new AbortController();
    const pending = await fetch(`${baseUrl}/api/resumes/merge-test/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal, body: JSON.stringify({ roleRequirements: "工程岗", question: "分析", ocrText, streamProgress: true }) });
    const reading = readAnalysisEvents(pending, () => {}).catch((error: unknown) => error);
    await ready;
    abort.abort();
    assert.ok(await reading instanceof Error);
    const cancelDeadline = Date.now() + 2000;
    while (!canceledReports && Date.now() < cancelDeadline) await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.ok(canceledReports > 0);
    assert.deepEqual(JSON.parse(await readFile(metadata, "utf8")), saved, "保存前取消分析不能追加半套评估记录。");
  } finally {
    child.kill();
    await new Promise<void>((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve()));
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
