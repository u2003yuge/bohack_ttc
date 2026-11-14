import "dotenv/config";
import express from "express";
import resumes from "./resumes.js";
import agents from "./agents/router.js";
import research from "./research/router.js";
import { deadline, errorMessage, limit } from "./operations.js";
import { normalizeProjectBreakdownRequest, structureJobRequirements, suggestAnalysisTask, suggestProjectBreakdown } from "./analysis.js";
import type { AnalysisEvent } from "../src/research-types.js";
import { resumeAnalysisAgentIds, runResumeAgents } from "./agents/registry.js";
import scoring from "./scoring/router.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
app.use(express.json({ limit: "2mb" }));
app.use("/api/resumes", express.raw({ type: "application/pdf", limit: "30mb" }), resumes);
app.use("/api/agents", agents);
app.use("/api/research", research);
app.use("/api/scoring", scoring);

app.get("/api/health", (_request, response) => response.json({
  agent: Boolean(process.env.OPENAI_API_KEY),
  webSearch: Boolean(process.env.TAVILY_API_KEY),
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
}));

app.post("/api/agent", async (request, response) => {
  const { resumeName, resumeText, roleRequirements = "", question, streamProgress = false } = request.body ?? {};
  if (Object.hasOwn(request.body ?? {}, "includeResearch") || Object.hasOwn(request.body ?? {}, "webResearchEnabled")) {
    response.status(400).json({ error: "候选人成果真实性核查与联网查找功能已移除。" });
    return;
  }
  if (typeof resumeText !== "string" || typeof question !== "string") {
    response.status(400).json({ error: "请提供简历文本和分析问题。" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }
  if (resumeText.length > 100_000 || typeof streamProgress !== "boolean") {
    response.status(400).json({ error: "简历文本不得超过 100000 字符，进度开关必须为布尔值。" });
    return;
  }
  const scope = deadline(undefined, limit("AGENT_TIMEOUT_MS", 300_000), "分析已达到总时限，请查看已完成资料或缩小问题范围后重试。");
  const disconnected = () => { if (!response.writableEnded) scope.abort(new Error("用户已取消分析或关闭页面。")); };
  response.once("close", disconnected);
  const emit = (event: AnalysisEvent) => {
    if (streamProgress && !response.writableEnded && !response.destroyed) response.write(`${JSON.stringify(event)}\n`);
  };
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (streamProgress) {
    response.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    response.flushHeaders();
    heartbeat = setInterval(() => emit({ type: "heartbeat" }), 10_000);
    heartbeat.unref();
    emit({ type: "progress", progress: { stage: "extracting", message: "分析请求已接收，正在处理。" } });
  }
  const started = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  const markdown: string[] = [];
  console.log(`[agent ${requestId}] started (candidate evidence only)`);
  try {
    const run = await runResumeAgents({
      context: { resumeText, fileName: resumeName || "未命名简历", roleRequirements, question, includeResearch: false, webResearchEnabled: false },
      requested: [...resumeAnalysisAgentIds],
      signal: scope.signal,
      onAgentComplete: ({ id, label, markdown: section, reused, completed, total, output }) => {
        if (section) {
          markdown.push(section);
          emit({ type: "agent", agentId: id, label, markdown: section, reused, completed, total });
        }
        emit({ type: "progress", progress: { stage: id.includes("research") ? "researching" : id === "score-calculation" ? "scoring" : "analyzing", completed, total, message: `${label}已完成${reused ? "（复用已有结果）" : ""}。` } });
        console.log(`[agent ${requestId}] ${id} ${completed}/${total} +${Date.now() - started}ms`);
      },
    });
    scope.signal.throwIfAborted();
    const report = run.outputs["analysis-report"] as { researchSources?: AnalysisResult["researchSources"]; researchStatus?: AnalysisResult["researchStatus"] } | undefined;
    const result: AnalysisResult = {
      answer: markdown.join("\n\n"),
      research: { items: [], notes: [] },
      ...(run.outputs["score-calculation"] ? { assessment: run.outputs["score-calculation"] as AnalysisResult["assessment"] } : {}),
      researchSources: report?.researchSources,
      researchStatus: report?.researchStatus,
    };
    if (!response.destroyed) {
      if (streamProgress) { emit({ type: "complete", ...result }); response.end(); }
      else response.json(result);
    }
  } catch (error) {
    const message = scope.signal.aborted ? errorMessage(scope.signal.reason) : errorMessage(error);
    const event: AnalysisEvent = { type: "error", error: `分析未完成：${message}` };
    if (!response.destroyed) {
      if (streamProgress) { emit(event); response.end(); }
      else response.status(502).json(event);
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    response.removeListener("close", disconnected);
    scope.dispose();
    console.log(`[agent ${requestId}] finished +${Date.now() - started}ms`);
  }
});

app.post("/api/agent/role-profile", async (request, response) => {
  const rawRequirements = request.body?.rawRequirements;
  if (typeof rawRequirements !== "string" || !rawRequirements.trim()) { response.status(400).json({ error: "请先输入职位要求。" }); return; }
  if (!process.env.OPENAI_API_KEY) { response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" }); return; }
  try { response.json(await structureJobRequirements(rawRequirements)); }
  catch (error) { response.status(502).json({ error: errorMessage(error) }); }
});

app.post("/api/agent/task-draft", async (request, response) => {
  const instruction = request.body?.instruction;
  if (typeof instruction !== "string" || !instruction.trim()) { response.status(400).json({ error: "请先填写分析任务。" }); return; }
  if (!process.env.OPENAI_API_KEY) { response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" }); return; }
  try { response.json(await suggestAnalysisTask(instruction)); }
  catch (error) { response.status(502).json({ error: errorMessage(error) }); }
});

app.post("/api/agent/project-breakdown", async (request, response) => {
  const normalized = normalizeProjectBreakdownRequest(request.body);
  if ("error" in normalized) { response.status(400).json({ error: normalized.error }); return; }
  if (!process.env.OPENAI_API_KEY) { response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" }); return; }
  try { response.json(await suggestProjectBreakdown(normalized.sources, normalized.reviewerFocus)); }
  catch (error) { response.status(502).json({ error: errorMessage(error) }); }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({ error: `简历处理失败：${errorMessage(error)}` });
});
app.listen(port, "127.0.0.1", () => console.log(`Agent API listening on http://localhost:${port}`));
