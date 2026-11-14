import assert from "node:assert/strict";
import test from "node:test";
import { resumeAgentCatalog, runResumeAgents } from "./registry.js";

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
    // @ts-expect-error Exercise runtime rejection of an agent removed from the public type.
    runResumeAgents({ context: context("2025 年获得全国数学建模竞赛一等奖。"), requested: ["achievement-research"] }),
    /核查 Agent 已移除/,
  );
});
