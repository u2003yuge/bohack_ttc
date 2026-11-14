import { createHash } from "node:crypto";
import {
  extractCandidate,
  generateInitialReport,
  generateRoleReport,
  suggestProjectBreakdown,
} from "../analysis.js";
import type { CandidateFields } from "../analysis.js";
import type { AgentDebug, AgentTiming } from "../../src/research-types.js";
import type { Assessment, MaterialInput } from "../../shared/material-scoring.js";
import { createAssessment } from "../scoring/pipeline.js";
import { enrichMaterialFacts, extractMaterials } from "../scoring/materials.js";
import { abilityDimensions, materialTypeLabels } from "../../shared/material-scoring.js";

export const resumeAgentIds = [
  "candidate-profile",
  "material-extraction",
  "score-calculation",
  "analysis-report",
  "plain-language-breakdown",
] as const;
export type ResumeAgentId = (typeof resumeAgentIds)[number];
export type LegacyResumeAgentId = "achievement-research";
export const resumeAnalysisAgentIds = resumeAgentIds;
const agentVersions: Record<ResumeAgentId, number> = {
  "candidate-profile": 2,
  // Bump both stages so older artifacts without the current action evidence
  // shape are recalculated instead of reusing all-NA ability scores.
  "material-extraction": 2,
  "score-calculation": 6,
  "analysis-report": 3,
  "plain-language-breakdown": 2,
};

export type ResumeAgentContext = {
  resumeText: string;
  fileName: string;
  roleRequirements?: string;
  question?: string;
  reviewerFocus?: string;
  useModel?: boolean;
  includeResearch?: boolean;
  webResearchEnabled?: boolean;
};
export type AgentArtifact = { id: ResumeAgentId; inputHash: string; output: unknown };
export type ResumeAgentRun = {
  requested: Array<ResumeAgentId | LegacyResumeAgentId>;
  executed: ResumeAgentId[];
  reused: ResumeAgentId[];
  outputs: Partial<Record<ResumeAgentId, unknown>>;
  artifacts: AgentArtifact[];
  debug: AgentDebug;
};

type Outputs = Partial<Record<ResumeAgentId, unknown>>;
type Definition = {
  id: ResumeAgentId;
  label: string;
  dependsOn: ResumeAgentId[];
  input: (context: ResumeAgentContext, outputs: Outputs) => unknown;
  run: (context: ResumeAgentContext, outputs: Outputs, signal?: AbortSignal) => Promise<unknown>;
};

const objectOutput = <T>(outputs: Outputs, id: ResumeAgentId): T => {
  const value = outputs[id];
  if (value === undefined) throw new Error(`Agent ${id} 的依赖结果缺失。`);
  return value as T;
};

const definitions: Record<ResumeAgentId, Definition> = {
  "candidate-profile": {
    id: "candidate-profile",
    label: "候选人基本信息提取",
    dependsOn: [],
    input: ({ resumeText, fileName }) => ({
      resumeText,
      fileName,
      modelEnabled: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    }),
    run: async ({ resumeText, fileName }, _outputs, signal) => extractCandidate(resumeText, fileName, signal),
  },
  "material-extraction": {
    id: "material-extraction",
    label: "简历材料抽取",
    dependsOn: [],
    input: ({ resumeText, useModel }) => ({
      resumeText,
      useModel: useModel !== false,
      modelEnabled: useModel !== false && Boolean(process.env.OPENAI_API_KEY),
      extractionModel: process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    }),
    run: async ({ resumeText, useModel }, _outputs, signal) => extractMaterials(resumeText, { signal, useModel }),
  },
  "score-calculation": {
    id: "score-calculation",
    label: "材料与能力规则评分",
    dependsOn: ["material-extraction"],
    input: (_context, outputs) => ({
      materials: objectOutput(outputs, "material-extraction"),
    }),
    run: async ({ resumeText }, outputs) => {
      const extracted = objectOutput<{ materials: MaterialInput[]; mode: "model" | "rules"; notes: string[] }>(outputs, "material-extraction");
      // Extraction anchors claims; enrich factors from the candidate's own
      // evidence before scoring or every ability dimension remains NA.
      const materials = enrichMaterialFacts(extracted.materials, { items: [], notes: [] });
      return createAssessment(resumeText, materials, {
        extraction: extracted.mode,
        notes: extracted.notes,
      }) satisfies Assessment;
    },
  },
  "analysis-report": {
    id: "analysis-report",
    label: "分析报告生成",
    dependsOn: ["candidate-profile", "score-calculation"],
    input: (context, outputs) => ({
      resumeText: context.resumeText,
      roleRequirements: context.roleRequirements ?? "",
      question: context.question ?? "",
      candidate: objectOutput(outputs, "candidate-profile"),
      assessment: objectOutput(outputs, "score-calculation"),
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    }),
    run: async (context, outputs, signal) => {
      signal?.throwIfAborted();
      const candidate = objectOutput<CandidateFields | null>(outputs, "candidate-profile");
      if (context.roleRequirements?.trim()) {
        const answer = await generateRoleReport({
          name: candidate?.name || context.fileName,
          resumeText: context.resumeText,
          roleRequirements: context.roleRequirements,
          question: `${context.question || "请根据职位要求分析候选人。"}\n\n严格遵循 Skill 的七个固定卡片：求职者基本信息、简历材料信息、项目经历人话拆解、疑点、与岗位需求重合度、建议提问、结论。七个卡片都必须输出，不要添加其它章节、开场白或编号。`,
          analysisContext: JSON.stringify({
            candidate,
            assessment: objectOutput<Assessment>(outputs, "score-calculation"),
          }),
        }, signal);
        return { answer, researchSources: [], researchStatus: "not-requested" as const };
      }
      const answer = await generateInitialReport({
        name: candidate?.name || context.fileName,
        role: candidate?.role ?? "",
        location: candidate?.location ?? "",
        education: candidate?.education ?? "",
        skills: candidate?.skills ?? [],
        resumeText: context.resumeText,
      }, signal);
      return { answer, researchSources: [], researchStatus: "not-requested" as const };
    },
  },
  "plain-language-breakdown": {
    id: "plain-language-breakdown",
    label: "项目经历人话拆解",
    dependsOn: ["material-extraction"],
    input: (context, outputs) => ({
      materials: objectOutput(outputs, "material-extraction"),
      reviewerFocus: context.reviewerFocus ?? "",
    }),
    run: async (context, outputs, signal) => {
      signal?.throwIfAborted();
      const extracted = objectOutput<{ materials: MaterialInput[] }>(outputs, "material-extraction");
      const sources = extracted.materials
        .filter((item) => item.material_type === "project" || item.material_type === "work")
        .slice(0, 4)
        .map((item) => ({ title: item.title, content: item.resume_claim }));
      if (!sources.length) return { projects: [], notes: ["没有抽取到可拆解的项目或工作经历。"] };
      return suggestProjectBreakdown(sources, context.reviewerFocus ?? "", signal);
    },
  },
};

export const resumeAgentCatalog = resumeAnalysisAgentIds.map((id) => {
  const { label, dependsOn } = definitions[id];
  return { id, label, dependsOn };
});

export function resumeAgentMarkdown(id: ResumeAgentId, output: unknown): string {
  const value = output && typeof output === "object" ? output as Record<string, unknown> : {};
  if (id === "candidate-profile") {
    const profile = output && typeof output === "object" ? output as Partial<CandidateFields> : null;
    if (!profile) return "### 候选人信息\n\n暂未从简历中提取到基本信息。";
    return `### 候选人信息\n\n| 项目 | 提取结果 |\n| --- | --- |\n| 姓名 | ${profile.name || "未识别"} |\n| 身份 | ${profile.identity || "未识别"} |\n| 关键词 | ${(profile.keywords ?? []).join("、") || "未识别"} |\n| 岗位 | ${profile.role || "未识别"} |\n| 地点 | ${profile.location || "未识别"} |\n| 教育 | ${profile.education || "未识别"} |\n| 技能 | ${(profile.skills ?? []).join("、") || "未识别"} |\n\n${profile.summary || ""}`;
  }
  if (id === "material-extraction") {
    const materials = Array.isArray(value.materials) ? value.materials as Array<Record<string, unknown>> : [];
    const list = materials.map((item) => `- **${materialTypeLabels[item.material_type as keyof typeof materialTypeLabels] ?? "经历"}｜${String(item.title ?? "未命名")}：** ${String(item.resume_claim ?? "")}`).join("\n");
    return `### 简历材料提取\n\n${list || "暂未提取到项目、工作、奖项或论文材料。"}`;
  }
  if (id === "score-calculation") {
    const assessment = output as Assessment;
    return `### 五维能力评分\n\n| 能力维度 | 规则得分 |\n| --- | ---: |\n${abilityDimensions.map(({ key, label }) => `| ${label} | ${assessment.abilities[key].score === null ? "NA" : assessment.abilities[key].score} |`).join("\n")}\n\n得分按已提取材料和个人行动证据计算。`;
  }
  if (id === "analysis-report") {
    const sources = Array.isArray(value.researchSources) ? value.researchSources as Array<{ title: string; url: string }> : [];
    const sourceList = sources.length ? `\n\n岗位背景来源（不作为候选人证据）：\n${sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}` : "";
    return `### 综合分析\n\n${String(value.answer ?? output ?? "分析 Agent 暂未返回内容。")}${sourceList}`;
  }
  if (id === "plain-language-breakdown") {
    const projects = Array.isArray(value.projects) ? value.projects as Array<Record<string, unknown>> : [];
    const list = projects.map((project) => `#### ${String(project.plainTitle ?? project.title ?? "项目经历")}\n\n- **要解决什么：** ${String(project.goal ?? "待核实")}\n- **具体做了什么：** ${String(project.actions ?? "待核实")}\n- **带来什么结果：** ${String(project.outcome ?? "待核实")}\n- **简历原文：** ${String(project.evidence ?? "")}`).join("\n\n");
    return `### 项目经历人话拆解\n\n${list || "没有可拆解的项目或工作经历。"}`;
  }
  return "";
}

function visit(id: ResumeAgentId, visited: Set<ResumeAgentId>, visiting: Set<ResumeAgentId>, order: ResumeAgentId[]) {
  if (visited.has(id)) return;
  if (visiting.has(id)) throw new Error(`Agent 依赖存在循环：${id}`);
  visiting.add(id);
  for (const dependency of definitions[id].dependsOn) visit(dependency, visited, visiting, order);
  visiting.delete(id);
  visited.add(id);
  order.push(id);
}

export async function runResumeAgents(input: {
  context: ResumeAgentContext;
    requested: Array<ResumeAgentId | LegacyResumeAgentId>;
  artifacts?: AgentArtifact[];
  force?: boolean;
  signal?: AbortSignal;
  onAgentComplete?: (agent: { id: ResumeAgentId; label: string; output: unknown; markdown: string; reused: boolean; completed: number; total: number; timing: AgentTiming }) => void | Promise<void>;
}): Promise<ResumeAgentRun> {
  if (!input.context.resumeText.trim() || input.context.resumeText.length > 100_000) {
    throw new Error("请提供 1 到 100000 字符的简历文本。");
  }
  if (!input.requested.length) throw new Error("请至少选择一个 Agent 功能。");
  const order: ResumeAgentId[] = [];
  const visited = new Set<ResumeAgentId>();
  for (const id of input.requested) {
    if (!resumeAnalysisAgentIds.includes(id as typeof resumeAnalysisAgentIds[number])) throw new Error(`该核查 Agent 已移除：${id}`);
    visit(id as ResumeAgentId, visited, new Set(), order);
  }

  const outputs: Outputs = {};
  const artifacts = new Map((input.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  const executed: ResumeAgentId[] = [];
  const reused: ResumeAgentId[] = [];
  const completedIds = new Set<ResumeAgentId>();
  let completed = 0;
  const pipelineStarted = performance.now();
  const timings: AgentTiming[] = [];
  let stageNumber = 0;

  // Run each dependency layer concurrently. Independent extraction, research,
  // annotation and scoring agents must not make one another wait.
  while (completedIds.size < order.length) {
    input.signal?.throwIfAborted();
    const ready = order.filter((id) => !completedIds.has(id) && definitions[id].dependsOn.every((dependency) => completedIds.has(dependency)));
    if (!ready.length) throw new Error("Agent 依赖无法形成可执行顺序。");
    const stage = stageNumber++;
    await Promise.all(ready.map(async (id) => {
      input.signal?.throwIfAborted();
      const startedAtMs = Math.round(performance.now() - pipelineStarted);
      const definition = definitions[id];
      const inputHash = createHash("sha256")
        .update(JSON.stringify({ agentVersion: agentVersions[id], input: definition.input(input.context, outputs) }))
        .digest("hex");
      const previous = artifacts.get(id);
      const canReuse = !(input.force && input.requested.includes(id)) && previous?.inputHash === inputHash;
      const output = canReuse ? previous!.output : await definition.run(input.context, outputs, input.signal);
      const durationMs = Math.max(0, Math.round(performance.now() - pipelineStarted) - startedAtMs);
      input.signal?.throwIfAborted();
      if (!canReuse) artifacts.set(id, { id, inputHash, output });
      outputs[id] = output;
      completedIds.add(id);
      if (canReuse) reused.push(id);
      else executed.push(id);
      completed += 1;
      const timing: AgentTiming = { id, label: definition.label, stage, startedAtMs, durationMs, reused: canReuse, parallelWith: ready.filter((other) => other !== id) };
      timings.push(timing);
      // Emit as soon as this independent Agent finishes; dependants still wait
      // for the complete layer below before starting.
      await input.onAgentComplete?.({
        id,
        label: definition.label,
        output,
        markdown: resumeAgentMarkdown(id, output),
        reused: canReuse,
        completed,
        total: order.length,
        timing,
      });
      return { id };
    }));
  }
  return {
    requested: input.requested as ResumeAgentId[],
    executed,
    reused,
    outputs,
    artifacts: [...artifacts.values()],
    debug: { totalDurationMs: Math.round(performance.now() - pipelineStarted), maxParallel: Math.max(1, ...[...new Set(timings.map((timing) => timing.stage))].map((currentStage) => timings.filter((timing) => timing.stage === currentStage).length)), timings: timings.sort((left, right) => left.startedAtMs - right.startedAtMs) },
  };
}
