import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import resumes from "./resumes.js";
import { searchPublicWeb } from "./web-search.js";
import { normalizeProjectBreakdownSources, structureJobRequirements, suggestAnalysisTask, suggestProjectBreakdown } from "./analysis.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const skill = readFileSync(
  fileURLToPath(new URL("./skills/resume-analysis.md", import.meta.url)),
  "utf8",
);

app.use(express.json({ limit: "2mb" }));
app.use("/api/resumes", express.raw({ type: "application/pdf", limit: "30mb" }), resumes);

app.get("/api/health", (_request, response) => {
  response.json({
    agent: Boolean(process.env.OPENAI_API_KEY),
    webSearch: Boolean(process.env.TAVILY_API_KEY),
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  });
});

app.post("/api/agent", async (request, response) => {
  const { resumeName, resumeText, roleRequirements, question } = request.body ?? {};
  if (typeof resumeText !== "string" || typeof question !== "string") {
    response.status(400).json({ error: "请提供简历文本和分析问题。" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  const webResearchEnabled = request.body?.webResearchEnabled === true;
  const canSearch = webResearchEnabled && Boolean(process.env.TAVILY_API_KEY);
  let usedSearch = false;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${skill}\n\n你是招聘团队的简历分析助手。遵守以上 Skill，提供有依据、审慎且公平的分析。${canSearch ? "需要核实职位相关公开信息时，可以使用 web_search 工具。" : "当前没有配置网页搜索服务，不要声称已进行网络搜索。"}`,
    },
    {
      role: "user",
      content: `候选人：${String(resumeName || "未命名简历")}\n\n职位要求：\n${String(roleRequirements || "尚未提供")}\n\n简历原文：\n<resume>\n${resumeText.slice(0, 100_000)}\n</resume>\n\n用户请求：${question}`,
    },
  ];

  try {
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = canSearch
      ? [
          {
            type: "function",
            function: {
              name: "web_search",
              description: "Search public web pages for role-relevant facts. Never investigate personal or sensitive details about a candidate.",
              parameters: {
                type: "object",
                properties: { query: { type: "string", description: "A concise job-related search query." } },
                required: ["query"],
                additionalProperties: false,
              },
            },
          },
        ]
      : [];

    for (let turn = 0; turn < 4; turn += 1) {
      const result = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        messages,
        ...(tools.length ? { tools, tool_choice: "auto" as const } : {}),
      });
      const message = result.choices[0]?.message;
      if (!message) throw new Error("模型未返回分析内容。");
      messages.push(message);
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        response.json({ answer: message.content ?? "模型未返回文本。", researchStatus: usedSearch ? "searched" : webResearchEnabled ? (process.env.TAVILY_API_KEY ? "not-requested" : "not-configured") : "not-requested" });
        return;
      }
      const searchCalls = calls.filter((call) => call.type === "function" && call.function.name === "web_search");
      const searchResults = await Promise.all(searchCalls.map(async (call, index) => {
        if (index >= 4) return { call, content: "本轮搜索请求过多，请合并查询条件后再搜索。" };
        try {
          const args = JSON.parse(call.function.arguments) as { query?: string };
          return { call, content: await searchWeb(String(args.query ?? "")) };
        } catch (error) {
          return { call, content: `网页搜索失败：${error instanceof Error ? error.message : "未知错误"}` };
        }
      }));
      usedSearch = searchResults.length > 0;
      for (const { call, content } of searchResults) messages.push({ role: "tool", tool_call_id: call.id, content });
    }
    response.status(502).json({ error: "Agent 调用工具次数过多，请缩小问题范围后重试。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    response.status(502).json({ error: `Agent 请求失败：${message}` });
  }
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
  const normalized = normalizeProjectBreakdownSources(request.body?.projects);
  if ("error" in normalized) {
    response.status(400).json({ error: normalized.error });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
    return;
  }
  try {
    response.json(await suggestProjectBreakdown(normalized.sources));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "项目拆解失败。" });
  }
});

async function searchWeb(query: string): Promise<string> {
  if (!process.env.TAVILY_API_KEY) return "网页搜索未配置。";
  return JSON.stringify(await searchPublicWeb(query));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "未知错误";
  response.status(500).json({ error: `简历处理失败：${message}` });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Agent API listening on http://localhost:${port}`);
});
