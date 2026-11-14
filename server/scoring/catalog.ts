import { createAssessment } from "./pipeline.js";
import {
  factorDefinitions,
  type Evidence,
  type FactorObservation,
  type MaterialInput,
  type MaterialType,
} from "../../shared/material-scoring.js";
import type { KnowledgeRecord } from "../../shared/knowledge.js";

export const catalogCandidateId = "__catalog__";
export const catalogCandidateName = "资料库背景";

function sourceEvidence(record: KnowledgeRecord, quote: string): Evidence {
  const source = record.evidenceSources?.find((item) => item.verified) ?? record.evidenceSources?.[0];
  return {
    origin: "research",
    quote,
    source: source?.title ?? "资料库条目背景",
    url: source?.url || record.officialUrl || null,
  };
}

function backgroundText(record: KnowledgeRecord): string {
  const pieces = [record.title, record.field, record.organizer, record.summary, ...record.signals];
  if (record.competition) {
    pieces.push(
      record.competition.category,
      record.competition.short_info,
      record.competition.info,
      record.competition.influence,
      record.competition.difficulty,
      record.competition.notes,
    );
  }
  if (record.venue) {
    pieces.push(
      record.venue.type,
      record.venue.scope,
      record.venue.short_info,
      record.venue.info,
      record.venue.influence,
      record.venue.difficulty,
      record.venue.ranking_note,
      ...record.venue.field,
      ...record.venue.notes,
    );
  }
  return pieces.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("；");
}

function chooseBackgroundFactor(
  type: MaterialType,
  key: string,
  quote: string,
  evidence: Evidence,
): FactorObservation | undefined {
  const definition = factorDefinitions[type].find((item) => item.key === key);
  if (!definition || definition.kind) return undefined;
  const choice = definition.choices.find((item) => {
    try {
      return new RegExp(item.pattern, "i").test(quote);
    } catch {
      return false;
    }
  });
  if (choice) return { value: choice.key, evidence };
  return undefined;
}

function catalogMaterial(record: KnowledgeRecord): MaterialInput {
  const materialType: MaterialType = record.kind === "competition" ? "award" : record.kind === "journal" ? "research" : "work";
  const quote = backgroundText(record);
  const evidence = sourceEvidence(record, quote);
  const factorObservations: Record<string, FactorObservation> = {};
  for (const definition of factorDefinitions[materialType]) {
    const observation = chooseBackgroundFactor(materialType, definition.key, quote, evidence);
    if (observation) factorObservations[definition.key] = observation;
  }

  // A company profile can describe organizational complexity, but it cannot
  // prove a candidate's responsibility, delivery, or impact.
  if (materialType === "work" && !factorObservations.complexity && /大型|全球|跨团队|基础设施|复杂|平台|业务规模/i.test(quote)) {
    const definition = factorDefinitions.work.find((item) => item.key === "complexity");
    const choice = definition?.choices.find((item) => item.key === "complex");
    if (choice) factorObservations.complexity = { value: choice.key, evidence };
  }

  return {
    material_id: `catalog-${record.id}`,
    material_type: materialType,
    title: record.title,
    year: record.competition?.report_year ?? record.venue?.checked_on ?? null,
    organization: record.organizer || null,
    stage: record.competition?.category ?? record.venue?.type ?? null,
    result: null,
    identifiers: [],
    resume_claim: quote,
    personal_action_evidence: [],
    sources: [evidence],
    external_facts: { catalog_id: record.id, catalog_kind: record.kind },
    factor_observations: factorObservations,
    notes: ["资料库背景评分：只评价公开条目背景，不证明候选人的个人经历。"],
    evidence_states: ["资料库背景"],
  };
}

export function buildCatalogAssessment(records: KnowledgeRecord[]) {
  const materials = records.map(catalogMaterial);
  return createAssessment(`资料库背景评分/${records.length}条`, materials, {
    extraction: "rules",
    notes: ["该评估面向资料库条目背景；个人行动和五维能力贡献保持 NA。"],
    research: { kind: "catalog-background", recordCount: records.length },
  });
}
