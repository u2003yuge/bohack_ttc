import { readFileSync } from "node:fs";
import {
  factorDefinitions,
  materialIdentity,
  materialTypeLabels,
  normalizeIdentity,
  stableMaterialId,
  type Evidence,
  type FactorDefinition,
  type FactorObservation,
  type MaterialInput,
  type MaterialType,
} from "../../shared/material-scoring.js";
import type { ResearchBatch, ResearchInput, ResearchItem } from "../../src/research-types.js";
import { isObject, modelClient, parseJson } from "../research/config.js";

const extractionSkill = readFileSync(new URL("../skills/material-extraction.md", import.meta.url), "utf8");
const stringValue = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const yearsIn = (text: string) => [...text.matchAll(/(?:19|20)\d{2}/g)].map((match) => Number(match[0]));
const normalizeIdentifier = (value: string) => {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[.,;，。；]+$/, "");
  return normalized.startsWith("arxiv:")
    ? normalized.replace(/^arxiv:\s*/, "arxiv:").replace(/v\d+$/, "")
    : normalized;
};
const validIdentifier = (value: string) =>
  /^(?:10\.\d{4,9}\/\S+|arxiv:\s*\d{4}\.\d{4,5}(?:v\d+)?)$/i.test(value.trim());
const usable = (text: string) =>
  !!text.trim() &&
  !/未知|未披露|未说明|无法判断|无法充分|未查到|不能确认|unknown|not available|cannot (?:assess|determine)/i.test(
    text,
  );

export function normalizeMaterialExtraction(
  value: unknown,
  text: string,
): { materials: MaterialInput[]; notes: string[] } {
  if (!isObject(value) || !Array.isArray(value.items)) throw new Error("材料提取结果缺少 items。");
  if (value.items.length > 100) throw new Error("单次最多处理 100 项材料，请分段提交。");
  const notes: string[] = [];
  const materials: MaterialInput[] = [];
  for (const raw of value.items) {
    if (!isObject(raw)) continue;
    const input = isObject(raw.input) ? raw.input : raw;
    const type =
      raw.material_type ??
      ({ competition: "award", paper: "research", project: "project" } as Record<string, MaterialType>)[
        String(raw.kind)
      ];
    if (typeof type !== "string" || !Object.hasOwn(materialTypeLabels, type)) {
      notes.push("跳过未知材料父类型。");
      continue;
    }
    const claim = stringValue(raw.resume_claim ?? raw.evidence);
    if (!claim || claim.length < 6 || !text.includes(claim)) {
      notes.push("跳过无法在简历中定位连续原文的材料。");
      continue;
    }
    const title = stringValue(raw.title ?? input.competition_name ?? input.title ?? input.project_name);
    if (!title || !normalizeIdentity(claim).includes(normalizeIdentity(title))) {
      notes.push("跳过原文无法支持的材料名称。");
      continue;
    }
    const anchored = (v: unknown) => {
      const s = stringValue(v);
      return s && normalizeIdentity(claim).includes(normalizeIdentity(s)) ? s : null;
    };
    const yearValue = input.year ?? input.award_year ?? input.project_year;
    const yearText = typeof yearValue === "number" ? String(yearValue) : stringValue(yearValue);
    const year =
      yearText && claim.includes(yearText) && yearsIn(yearText).length
        ? typeof yearValue === "number"
          ? yearValue
          : yearText
        : null;
    const context = isObject(raw.context) ? raw.context : {};
    const actions = Array.isArray(raw.personal_actions)
      ? raw.personal_actions.filter(
          (s): s is string => typeof s === "string" && s.length >= 6 && claim.includes(s),
        )
      : [claim];
    const resumeEvidence: Evidence = { origin: "resume", quote: claim, source: "简历原文" };
    const material: MaterialInput = {
      material_id: "",
      material_type: type as MaterialType,
      title,
      year,
      organization: anchored(input.organization),
      stage: anchored(input.stage ?? context.stage ?? context.track),
      result: anchored(input.result ?? input.award_name),
      identifiers: [
        ...new Set([
          ...(Array.isArray(input.identifiers)
            ? input.identifiers
                .filter((s): s is string => typeof s === "string" && claim.includes(s) && validIdentifier(s))
                .map(normalizeIdentifier)
            : []),
          ...[...claim.matchAll(/10\.\d{4,9}\/[\w.\-;()/]+|arxiv:\s*\d{4}\.\d{4,5}/gi)].map((m) =>
            normalizeIdentifier(m[0]),
          ),
        ]),
      ],
      resume_claim: claim,
      personal_action_evidence: actions.map((quote) => ({ ...resumeEvidence, quote })),
      sources: [resumeEvidence],
      external_facts: {
        input_role: anchored(input.role),
        input_context: Object.fromEntries(
          Object.entries(context).filter(
            ([key, v]) =>
              (type === "award"
                ? ["division", "track", "stage", "region"]
                : type === "research"
                  ? ["authors", "year", "doi", "arxiv_id", "url", "track", "version"]
                  : []
              ).includes(key) &&
              typeof v === "string" &&
              claim.includes(v),
          ),
        ),
      },
      factor_observations: {},
      notes: [],
      evidence_states: ["简历自述"],
    };
    material.material_id = stableMaterialId(materialIdentity(material));
    materials.push(material);
  }
  return { materials, notes };
}

export function extractMaterialsByRules(text: string) {
  const items = text
    .split(/[。\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6)
    .flatMap((claim) => {
      let type: MaterialType | undefined;
      if (/专利|patent/i.test(claim)) type = "patent";
      else if (/论文|预印本|arxiv|doi|paper|publication/i.test(claim)) type = "research";
      else if (
        /竞赛|一等奖|二等奖|三等奖|金牌|银牌|铜牌|获奖|competition|first prize|gold medal/i.test(claim)
      )
        type = "award";
      else if (/开源|github|pull request|opensource|open.source/i.test(claim)) type = "opensource";
      else if (/证书|认证考试|课程|certificate|course/i.test(claim)) type = "certificate";
      else if (/项目|平台|系统|服务|project|platform|system|service/i.test(claim))
        type = /实习|任职|工作经历|internship|employment/i.test(claim) ? "work" : "project";
      else if (
        /负责|交付|协调|带领|开发|设计|测试|重构|搭建|分析|implemented|developed|designed|delivered|responsible for/i.test(
          claim,
        )
      )
        type = "work";
      if (!type) return [];
      const heading = claim.match(
        /(?:项目名称|论文题目|项目|论文|竞赛|Project|Paper)\s*[:：]\s*([^，；;：:]{3,90})/i,
      )?.[1];
      const title =
        heading?.trim() ??
        claim
          .split(/[：:；;]/)[0]
          .trim()
          .slice(0, 90);
      return [
        {
          material_type: type,
          title,
          year: yearsIn(claim)[0] ?? null,
          resume_claim: claim,
          personal_actions: [claim],
        },
      ];
    });
  const result = normalizeMaterialExtraction({ items }, text);
  result.notes.push("使用保守规则抽取材料；可能遗漏跨行标题、隐含职责或复杂版本关系，可补充清晰原文后复评。");
  return result;
}

export async function extractMaterials(
  text: string,
  options: { signal?: AbortSignal; useModel?: boolean } = {},
) {
  if (!text.trim() || text.length > 100_000) throw new Error("请提供 1 到 100000 字符的简历文本。");
  if (!process.env.OPENAI_API_KEY || options.useModel === false)
    return { ...extractMaterialsByRules(text), mode: "rules" as const };
  try {
    const result = await modelClient().chat.completions.create(
      {
        model: process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: extractionSkill },
          { role: "user", content: `<resume>\n${text}\n</resume>` },
        ],
      },
      { signal: options.signal },
    );
    return {
      ...normalizeMaterialExtraction(parseJson(result.choices[0]?.message.content ?? ""), text),
      mode: "model" as const,
    };
  } catch (error) {
    options.signal?.throwIfAborted();
    const fallback = extractMaterialsByRules(text);
    fallback.notes.push(
      `模型材料提取失败，已使用规则抽取：${error instanceof Error ? error.message : "未知错误"}`,
    );
    return { ...fallback, mode: "rules" as const };
  }
}

export function toResearchItems(materials: MaterialInput[]): ResearchItem[] {
  return materials.flatMap((m): ResearchItem[] => {
    const kind = ({ award: "competition", research: "paper", project: "project" } as const)[
      m.material_type as "award" | "research" | "project"
    ];
    if (!kind) return [];
    const input: ResearchInput =
      kind === "competition"
        ? {
            competition_name: m.title,
            award_name: m.result,
            award_year:
              typeof m.year === "number" ? m.year : m.year && /^\d{4}$/.test(m.year) ? Number(m.year) : null,
            age_at_award: null,
          }
        : kind === "paper"
          ? { title: m.title, description: null }
          : {
              project_name: m.title,
              project_year: m.year,
              organization: m.organization,
              role: stringValue(m.external_facts.input_role),
            };
    const required =
      kind === "competition"
        ? ["competition_name", "award_name", "award_year"]
        : kind === "paper"
          ? ["title"]
          : ["project_name", "project_year", "organization"];
    return [
      {
        kind,
        input,
        context: isObject(m.external_facts.input_context)
          ? (m.external_facts.input_context as Record<string, string | null>)
          : {},
        evidence: m.resume_claim,
        missingFields: required.filter((key) => input[key as keyof typeof input] == null),
        notes: [],
      },
    ];
  });
}

function choose(def: FactorDefinition, evidence: Evidence): FactorObservation | undefined {
  const clauses = evidence.quote
    .split(/[。；;\n]|但是|但|however\b/i)
    .map((v) => v.trim())
    .filter(
      (v) =>
        usable(v) &&
        !/(?:尚未|未能|没有|无法|未通过|未上线|未部署|未交付|未验证|未复现|未执行|不具备|without|not (?:yet|deployed|released|validated|reproduced))/i.test(
          v,
        ),
    );
  for (const item of def.choices) {
    const quote = clauses.find((clause) => new RegExp(item.pattern, "i").test(clause));
    if (quote) return { value: item.key, evidence: { ...evidence, quote } };
  }
  return;
}
function field(report: Record<string, unknown>, path: string): string | null {
  let current: unknown = report;
  for (const key of path.split(".")) current = isObject(current) ? current[key] : undefined;
  if (typeof current === "string") return current;
  if (typeof current === "number" && Number.isFinite(current)) return String(current);
  return current && typeof current === "object" ? JSON.stringify(current) : null;
}
const fieldMap: Record<MaterialType, Record<string, string[]>> = {
  award: {
    participants: ["year_data.participants"],
    award_rate: ["year_data.award_rate"],
    tier: [],
    judging: ["prizes_and_rules.judging_rules", "prizes_and_rules.competition_format"],
  },
  research: {
    question: ["paper.research_content"],
    rigor: ["paper_evaluation.research_quality", "paper.research_content"],
    experiments: ["paper_evaluation.research_quality", "paper.research_content"],
    reproducibility: ["paper_evaluation.open_resources"],
    status: ["publication.status"],
    content: ["paper.research_content", "paper_evaluation.research_quality"],
  },
  project: {
    complexity: ["project.description", "year_data.work_content"],
    constraints: ["year_data.technology", "year_data.work_content"],
    delivery: ["year_data.outcomes", "year_data.timeline"],
    adoption: ["year_data.outcomes"],
    outcome: ["year_data.outcomes"],
  },
  work: {},
  patent: {},
  opensource: {},
  certificate: {},
};
export function enrichMaterialFacts(materials: MaterialInput[], research: ResearchBatch): MaterialInput[] {
  return materials.map((input) => {
    const material: MaterialInput = {
      ...input,
      sources: [...input.sources],
      external_facts: { ...input.external_facts },
      factor_observations: {},
      notes: [...input.notes],
      evidence_states: [...input.evidence_states],
    };
    const result = research.items.find(
      (entry) =>
        entry.item.evidence === input.resume_claim &&
        String(
          entry.item.input.competition_name ?? entry.item.input.title ?? entry.item.input.project_name,
        ) === input.title,
    );
    const report = result?.report;
    const validReport = report && (result.status === "cached" || result.status === "researched");
    const officialSite = report
      ? field(
          report,
          material.material_type === "award"
            ? "competition.official_website"
            : material.material_type === "research"
              ? "publication.venue_url"
              : "project.official_website",
        )
      : null;
    const officialSource = validReport
      ? report.sources.find((source) => {
          try {
            return (
              !!source.url &&
              !!officialSite &&
              new URL(source.url).hostname === new URL(officialSite).hostname
            );
          } catch {
            return false;
          }
        })
      : undefined;
    if (validReport) {
      material.external_facts = {
        ...material.external_facts,
        report: JSON.parse(JSON.stringify(report)),
        research_status: result.status,
      };
      const canonicalTitle = field(
        report,
        material.material_type === "award"
          ? "competition.official_name"
          : material.material_type === "research"
            ? "paper.official_title"
            : "project.official_name",
      );
      if (canonicalTitle) material.external_facts.canonical_title = canonicalTitle;
      material.sources.push(
        ...report.sources.map((s): Evidence => ({
          origin: "research",
          quote: s.information,
          source: s.title,
          url: s.url,
        })),
      );
      material.notes.push(...report.notes);
      if (officialSource) material.evidence_states.push("背景已核实");
      if (report.notes.some((note) => /冲突|无法消歧|歧义未|contradict|unresolved ambiguity/i.test(note)))
        material.evidence_states.push("冲突/未能消歧");
      // Identifiers confirmed by a paper report connect preprint and published records.
      if (material.material_type === "research") {
        const ids = field(report, "paper.identifiers") ?? "";
        material.identifiers.push(
          ...[...ids.matchAll(/10\.\d{4,9}\/[\w.\-;()/]+|arxiv:\s*\d{4}\.\d{4,5}/gi)].map((m) =>
            normalizeIdentifier(m[0]),
          ),
        );
        const relationship = [
          field(report, "paper.other_details"),
          field(report, "publication.other_details"),
        ]
          .filter(Boolean)
          .join(" ");
        const authors = field(report, "paper.authors");
        if (
          canonicalTitle &&
          authors &&
          /同一研究成果|同一论文|same (?:paper|work)|预印本.{0,20}(?:正式版本|会议版|期刊版)/i.test(
            relationship,
          ) &&
          !/新增研究|独立成果|无法确认|显著扩展|new study|independent work/i.test(relationship)
        ) {
          material.external_facts.version_group = `${normalizeIdentity(canonicalTitle)}:${normalizeIdentity(authors)}`;
        }
      }
    } else if (result?.error) material.notes.push(result.error);
    for (const def of factorDefinitions[material.material_type]) {
      let observation: FactorObservation | undefined;
      if (validReport)
        for (const path of fieldMap[material.material_type][def.key] ?? []) {
          const quote = field(report, path);
          if (!quote || !usable(quote)) continue;
          if (
            def.kind &&
            material.year !== null &&
            /^\d{4}$/.test(String(material.year)) &&
            [...quote.matchAll(/((?:19|20)\d{2})\s*年|(?:year|season)\s*((?:19|20)\d{2})/gi)].some(
              (match) => Number(match[1] || match[2]) !== Number(material.year),
            )
          ) {
            material.notes.push(`${def.label} 的年份口径与目标材料不一致，保持 NA。`);
            continue;
          }
          const source = officialSource ?? report.sources[0];
          if (!source) continue;
          const evidence: Evidence = {
            origin: "research",
            quote,
            source: source.title,
            url: source.url,
            path,
          };
          if (def.kind === "size") {
            const number = quote
              .replace(/,/g, "")
              .match(/(\d+(?:\.\d+)?)\s*(万|亿)?\s*(?:人|队|作品|participants|teams|entries)/i);
            if (
              number &&
              /有效|实际参赛|参赛队|参赛作品|effective|valid|actual|participating/i.test(quote) &&
              !/报名|计划|上限|registered|planned/i.test(quote)
            )
              observation = {
                value: Number(number[1]) * (number[2] === "万" ? 10000 : number[2] === "亿" ? 100000000 : 1),
                evidence,
                official: !!officialSource,
              };
          } else if (def.kind === "selectivity" && officialSource) {
            const percentage = quote.match(/(\d+(?:\.\d+)?)\s*[%％]/);
            const proportion = /^0?\.\d+$|^1(?:\.0+)?$/.test(quote.trim()) ? Number(quote) : undefined;
            if (percentage || proportion !== undefined)
              observation = {
                value: percentage ? Number(percentage[1]) / 100 : proportion!,
                evidence,
                official: true,
              };
          } else observation = choose(def, evidence);
          if (observation) break;
        }
      if (!observation && !def.kind) {
        // Award tier must come from this candidate's claimed award, not all awards in an event.
        const quote =
          material.material_type === "award" && def.key === "tier"
            ? (material.result ?? material.resume_claim)
            : material.resume_claim;
        observation = choose(def, { origin: "resume", quote, source: "简历原文" });
      }
      if (observation) material.factor_observations[def.key] = observation;
    }
    material.identifiers = [...new Set(material.identifiers)];
    material.evidence_states = [...new Set(material.evidence_states)];
    material.material_id = stableMaterialId(materialIdentity(material));
    return material;
  });
}
