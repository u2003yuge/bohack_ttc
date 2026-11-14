import assert from "node:assert/strict";
import test from "node:test";
import { resumeAgentCatalog, resumeAgentMarkdown, runResumeAgents } from "./registry.js";

const context = (resumeText: string) => ({ resumeText, fileName: "candidate.pdf", useModel: false });

test("Agent 注册表按功能拆分，并公开依赖关系", () => {
  assert.deepEqual(resumeAgentCatalog.map((agent) => agent.id), [
    "candidate-profile",
    "material-extraction",
    "score-calculation",
    "analysis-report",
    "plain-language-breakdown",
  ]);
  assert.deepEqual(resumeAgentCatalog.find((agent) => agent.id === "score-calculation")?.dependsOn, [
    "material-extraction",
  ]);
});

test("候选人画像输出包含单一身份描述和证据关键词", () => {
  const markdown = resumeAgentMarkdown("candidate-profile", {
    name: "林同学",
    identity: "计算机视觉方向硕士研究生",
    keywords: ["视觉模型", "工程部署", "竞赛获奖"],
    role: "算法工程师",
    location: "上海",
    education: "硕士",
    skills: ["Python"],
    summary: "有模型训练和部署经历。",
  });
  assert.match(markdown, /\| 身份 \| 计算机视觉方向硕士研究生 \|/);
  assert.match(markdown, /\| 关键词 \| 视觉模型、工程部署、竞赛获奖 \|/);
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

test("已移除候选人成果真实性核查 Agent", async () => {
  await assert.rejects(
    // Exercise runtime rejection of a legacy agent ID accepted only for migration safety.
    runResumeAgents({ context: context("2025 年获得全国数学建模竞赛一等奖。"), requested: ["achievement-research"] }),
    /核查 Agent 已移除/,
  );
});
