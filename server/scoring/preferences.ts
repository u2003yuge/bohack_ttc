import { readFileSync } from "node:fs";
import {
  abilityDimensions,
  jobPresets,
  normalizeJobPreference,
  presetPreference,
  type JobPreference,
} from "../../shared/material-scoring.js";
import { modelClient, parseJson } from "../research/config.js";

const skill = readFileSync(new URL("../skills/job-preferences-v1.md", import.meta.url), "utf8");
const aliases = [
  "专业执行|技术实现|专业能力|execution|implementation",
  "问题解决|解题|分析能力|problem.solving",
  "责任与交付|责任交付|独立交付|交付|ownership|delivery",
  "协作与组织|协作组织|团队协作|组织|协作|collaboration",
  "学习与研究|学习研究|研究|学习|research|learning",
];
export function preferenceByRules(instruction: string, current: JobPreference): JobPreference {
  let base = normalizeJobPreference(current);
  if (/管理岗|团队管理|带队|manager/i.test(instruction)) base = presetPreference(jobPresets[4]);
  else if (/研究岗|科研岗|算法研究|research role/i.test(instruction)) base = presetPreference(jobPresets[2]);
  else if (/开发岗|工程岗|后端|前端|工程师|engineer/i.test(instruction))
    base = presetPreference(jobPresets[1]);
  else if (/交付岗|项目经理|delivery role/i.test(instruction)) base = presetPreference(jobPresets[3]);
  const weights = { ...base.weights };
  const explicit: Partial<typeof weights> = {};
  abilityDimensions.forEach(({ key }, index) => {
    const match = instruction.match(
      new RegExp(
        `(?:${aliases[index]})\\s*(?:权重|占比|为|占|[:：=])?\\s*(\\d+(?:\\.\\d+)?)\\s*([%％]?)`,
        "i",
      ),
    );
    if (match) explicit[key] = Number(match[1]) / (match[2] || Number(match[1]) > 1 ? 100 : 1);
    else if (new RegExp(aliases[index], "i").test(instruction))
      weights[key] *= new RegExp(`(?:降低|减少|不看重|less).{0,10}(?:${aliases[index]})`, "i").test(
        instruction,
      )
        ? 0.5
        : 2;
  });
  const specified = Object.keys(explicit);
  if (specified.length) {
    const used = Object.values(explicit).reduce((sum, v) => sum + (v ?? 0), 0);
    const otherTotal = abilityDimensions.reduce(
      (sum, { key }) => sum + (explicit[key] === undefined ? base.weights[key] : 0),
      0,
    );
    abilityDimensions.forEach(({ key }) => {
      weights[key] =
        explicit[key] ?? (used < 1 && otherTotal > 0 ? (base.weights[key] / otherTotal) * (1 - used) : 0);
    });
  }
  const required = [...instruction.matchAll(/(?:必须|必备|must have)\s*[:：]?\s*([^，。；;\n]+)/gi)].map(
    (m) => m[1].trim(),
  );
  return normalizeJobPreference({
    ...base,
    title: current.title || base.title,
    weights,
    must_have: [...new Set([...current.must_have, ...required])],
    rationale: "按明确比例或强调词生成岗位权重；未说明的部分保留预设相对比例。",
  });
}
export async function suggestJobPreference(
  instruction: string,
  current: JobPreference,
  signal?: AbortSignal,
) {
  if (!instruction.trim() || instruction.length > 2000) throw new Error("请输入 1 到 2000 字的岗位偏好。");
  const fallback = preferenceByRules(instruction, current);
  if (!process.env.OPENAI_API_KEY) return { preference: fallback, mode: "rules" };
  try {
    const result = await modelClient().chat.completions.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: skill },
          { role: "user", content: JSON.stringify({ instruction, current }) },
        ],
      },
      { signal },
    );
    return {
      preference: normalizeJobPreference(parseJson(result.choices[0]?.message.content ?? "")),
      mode: "model",
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      preference: fallback,
      mode: "rules",
      note: `模型建议不可用，已使用规则方案：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }
}
