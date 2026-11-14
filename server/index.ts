import "dotenv/config";
import express from "express";
import resumes from "./resumes.js";
import { normalizeProjectBreakdownRequest, structureJobRequirements, suggestAnalysisTask, suggestProjectBreakdown } from "./analysis.js";
import research from "./research/router.js";
import scoring from "./scoring/router.js";
import { analyzeResume } from "./agent.js";
import { respondWithAnalysis } from "./analysis-response.js";
import { errorMessage } from "./operations.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
app.use(express.json({ limit: "2mb" }));
app.use("/api/resumes", express.raw({ type: "application/pdf", limit: "30mb" }), resumes);
app.use("/api/research", research);
app.use("/api/scoring", scoring);

app.get("/api/health", (_request, response) => {
  response.json({ agent: Boolean(process.env.OPENAI_API_KEY), webSearch: Boolean(process.env.TAVILY_API_KEY), model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini" });
});

app.post("/api/agent", async (request, response) => {
  const { resumeName, resumeText, roleRequirements, question, includeResearch = true, streamProgress = false, webResearchEnabled = false } = request.body ?? {};
  if (typeof resumeText !== "string" || typeof question !== "string") {
    response.status(400).json({ error: "请提供简历文本和分析问题。" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }
  if (resumeText.length > 100_000 || typeof includeResearch !== "boolean" || typeof streamProgress !== "boolean" || typeof webResearchEnabled !== "boolean") {
    response.status(400).json({ error: "简历文本不得超过 100000 字符，核查和进度开关必须为布尔值。" });
    return;
  }
  await respondWithAnalysis(request, response, (options) => analyzeResume({ resumeName, resumeText, roleRequirements, question, includeResearch, webResearchEnabled }, options));
});

app.post("/api/agent/role-profile", async (request, response) => {
  const rawRequirements = request.body?.rawRequirements;
  if (typeof rawRequirements !== "string" || !rawRequirements.trim()) {
    response.status(400).json({ error: "请先输入职位要求。" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }
  try {
    response.json(await structureJobRequirements(rawRequirements));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "职位要求整理失败。" });
  }
});

app.post("/api/agent/task-draft", async (request, response) => {
  const instruction = request.body?.instruction;
  if (typeof instruction !== "string" || !instruction.trim()) {
    response.status(400).json({ error: "请先填写分析任务。" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }
  try {
    response.json(await suggestAnalysisTask(instruction));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "分析任务整理失败。" });
  }
});

app.post("/api/agent/project-breakdown", async (request, response) => {
  const normalized = normalizeProjectBreakdownRequest(request.body);
  if ("error" in normalized) {
    response.status(400).json({ error: normalized.error });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }
  try {
    response.json(await suggestProjectBreakdown(normalized.sources, normalized.reviewerFocus));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "项目拆解失败。" });
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({ error: `简历处理失败：${errorMessage(error)}` });
});
app.listen(port, "127.0.0.1", () => console.log(`Agent API listening on http://localhost:${port}`));
