import "dotenv/config";
import express from "express";
import resumes from "./resumes.js";
import research from "./research/router.js";
import { AnalysisFailure, analyzeResume } from "./agent.js";
import { deadline, errorMessage, limit } from "./operations.js";
import type { AnalysisEvent } from "../src/research-types.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
app.use(express.json({ limit: "2mb" }));
app.use("/api/resumes", express.raw({ type: "application/pdf", limit: "30mb" }), resumes);
app.use("/api/research", research);

app.get("/api/health", (_request, response) => {
  response.json({ agent: Boolean(process.env.OPENAI_API_KEY), webSearch: Boolean(process.env.TAVILY_API_KEY), model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini" });
});

app.post("/api/agent", async (request, response) => {
  const { resumeName, resumeText, roleRequirements, question, includeResearch = true, streamProgress = false } = request.body ?? {};
  if (typeof resumeText !== "string" || typeof question !== "string") {
    response.status(400).json({ error: "请提供简历文本和分析问题。" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }
  if (resumeText.length > 100_000 || typeof includeResearch !== "boolean" || typeof streamProgress !== "boolean") {
    response.status(400).json({ error: "简历文本不得超过 100000 字符，核查和进度开关必须为布尔值。" });
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
    emit({ type: "progress", progress: { stage: includeResearch ? "extracting" : "analyzing", message: "分析请求已接收，正在处理。" } });
  }
  const started = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[agent ${requestId}] started (research=${includeResearch})`);
  try {
    const result = await analyzeResume({ resumeName, resumeText, roleRequirements, question, includeResearch }, {
      signal: scope.signal,
      emit: (event) => {
        emit(event);
        if (event.type === "progress") console.log(`[agent ${requestId}] ${event.progress.stage} ${event.progress.completed ?? ""}/${event.progress.total ?? ""} +${Date.now() - started}ms`);
      },
    });
    if (!response.destroyed) {
      if (streamProgress) { emit({ type: "complete", ...result }); response.end(); }
      else response.json(result);
    }
  } catch (error) {
    const message = scope.signal.aborted ? errorMessage(scope.signal.reason) : errorMessage(error);
    const event: AnalysisEvent = { type: "error", error: `分析未完成：${message}`, ...(error instanceof AnalysisFailure ? { research: error.research } : {}) };
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

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({ error: `简历处理失败：${errorMessage(error)}` });
});
app.listen(port, "127.0.0.1", () => console.log(`Agent API listening on http://localhost:${port}`));
