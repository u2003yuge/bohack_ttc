import assert from "node:assert/strict";
import test from "node:test";
import { resumeAgentCatalog, runResumeAgents } from "./registry.js";

const context = (resumeText: string) => ({ resumeText, fileName: "candidate.pdf", useModel: false });

test("Agent 注册表按功能拆分，并公开依赖关系", () => {
  assert.deepEqual(resumeAgentCatalog.map((agent) => agent.id), [
    "candidate-profile",
    "material-extraction",
    "competition-research",
    "paper-research",
    "project-research",
    "achievement-research",
    "evidence-annotations",
    "score-calculation",
    "analysis-report",
    "plain-language-breakdown",
  ]);
  assert.deepEqual(resumeAgentCatalog.find((agent) => agent.id === "score-calculation")?.dependsOn, [
    "material-extraction",
    "achievement-research",
  ]);
});

test("已完成的 Agent 输入未变时复用缓存，文本变化时只重跑材料抽取", async () => {
  const first = await runResumeAgents({
    context: context("2025 年获得全国大学生数学建模竞赛一等奖。"),
    requested: ["material-extraction"],
  });
  assert.deepEqual(first.executed, ["material-extraction"]);
  assert.deepEqual(first.reused, []);

  const reused = await runResumeAgents({
    context: context("2025 年获得全国大学生数学建模竞赛一等奖。"),
    requested: ["material-extraction"],
    artifacts: first.artifacts,
  });
  assert.deepEqual(reused.executed, []);
  assert.deepEqual(reused.reused, ["material-extraction"]);

  const changed = await runResumeAgents({
    context: context("2025 年获得全国大学生数学建模竞赛一等奖；另负责数据平台项目。"),
    requested: ["material-extraction"],
    artifacts: reused.artifacts,
  });
  assert.deepEqual(changed.executed, ["material-extraction"]);
  assert.deepEqual(changed.reused, []);
});

test("只新增论文材料时复用竞赛与项目核查，只重跑论文核查及汇总", async () => {
  const openaiKey = process.env.OPENAI_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    const first = await runResumeAgents({
      context: context("2025 年获得全国数学建模竞赛一等奖。\n项目：校园数据平台，负责搭建数据服务。"),
      requested: ["achievement-research"],
    });
    const second = await runResumeAgents({
      context: context("2025 年获得全国数学建模竞赛一等奖。\n项目：校园数据平台，负责搭建数据服务。\n论文：智能推荐方法研究。"),
      requested: ["achievement-research"],
      artifacts: first.artifacts,
    });
    assert.deepEqual(second.executed, ["material-extraction", "paper-research", "achievement-research"]);
    assert.deepEqual(second.reused, ["competition-research", "project-research"]);
  } finally {
    if (openaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openaiKey;
    if (tavilyKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = tavilyKey;
  }
});
