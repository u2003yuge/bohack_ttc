import { createHash, randomUUID } from "node:crypto";
import {
  abilityDimensions,
  actionLevels,
  calibrationStatus,
  decayRatio,
  factorDefinitions,
  scoreMaterials,
  scoringVersion,
  typeAdaptation,
  type Assessment,
  type MaterialInput,
} from "../../shared/material-scoring.js";
import type { AnalysisEvent, ResearchBatch } from "../../src/research-types.js";
import { deadline, interruptible, limit } from "../operations.js";
import { enrichResume } from "../research/runner.js";
import { enrichMaterialFacts, extractMaterials, toResearchItems } from "./materials.js";

type EvaluationOptions = {
  signal?: AbortSignal;
  includeResearch?: boolean;
  useModel?: boolean;
  emit?: (event: AnalysisEvent) => void;
  rho?: number;
  research?: ResearchBatch;
};
export async function evaluateResume(text: string, options: EvaluationOptions = {}) {
  const scope = deadline(
    options.signal,
    limit("RESEARCH_TIMEOUT_MS", 180_000),
    "材料整理已达到时限，请分段提交或稍后重试。",
  );
  try {
    options.emit?.({
      type: "progress",
      progress: { stage: "extracting", message: "正在整理七类材料和个人行动原文。" },
    });
    const extracted = await interruptible(
      extractMaterials(text, { signal: scope.signal, useModel: options.useModel }),
      scope.signal,
    );
    let research = options.research ?? ({ items: [], notes: [] } as ResearchBatch);
    if (!options.research && options.includeResearch !== false) {
      const items = toResearchItems(extracted.materials);
      if (items.length)
        research = await enrichResume(text, {
          signal: scope.signal,
          extract: async () => ({ items, notes: [] }),
          canSearch: !!process.env.TAVILY_API_KEY && !!process.env.OPENAI_API_KEY,
          onProgress: (progress) => options.emit?.({ type: "progress", progress }),
          onUpdate: (batch) => options.emit?.({ type: "research", research: batch }),
        });
    }
    scope.signal.throwIfAborted();
    options.emit?.({ type: "research", research });
    options.emit?.({
      type: "progress",
      progress: { stage: "scoring", message: "正在按固定规则计算材料分、个人贡献和五维能力。" },
    });
    const inputs = enrichMaterialFacts(extracted.materials, research);
    const assessment = createAssessment(text, inputs, {
      extraction: extracted.mode,
      notes: [...extracted.notes, ...research.notes],
      research,
      rho: options.rho,
    });
    options.emit?.({ type: "assessment", assessment });
    return { assessment, research };
  } finally {
    scope.dispose();
  }
}

export function createAssessment(
  text: string,
  inputs: MaterialInput[],
  options: { extraction?: "model" | "rules"; notes?: string[]; research?: unknown; rho?: number } = {},
): Assessment {
  const rho = options.rho ?? decayRatio;
  return {
    id: randomUUID(),
    version: scoringVersion,
    evaluatedAt: new Date().toISOString(),
    inputHash: createHash("sha256")
      .update(JSON.stringify({ text, inputs, version: scoringVersion, rho }))
      .digest("hex"),
    extraction: options.extraction ?? "rules",
    calibration: calibrationStatus,
    rho,
    ...scoreMaterials(inputs, rho),
    notes: options.notes ?? [],
    inputSnapshot: text,
    researchSnapshot: options.research ?? null,
    rulesSnapshot: { factorDefinitions, typeAdaptation, actionLevels, rho },
  };
}

export function assessmentReport(assessment: Assessment): string {
  const lines = abilityDimensions.map(
    ({ key, label }) =>
      `${label}：${assessment.abilities[key].score === null ? "NA（证据不足）" : `${assessment.abilities[key].score} 分${assessment.abilities[key].provisional ? "（暂定）" : ""}`}`,
  );
  return [
    `材料证据画像 · ${assessment.version}`,
    `共整理 ${assessment.materials.length} 项材料。${assessment.calibration}。`,
    ...lines,
    "分数由材料因素、个人行动、类型适配系数及同类型递减聚合派生。未知信息保持 NA；岗位权重仅用于当前岗位排序。",
    ...assessment.notes,
  ].join("\n\n");
}
