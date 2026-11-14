import { findKnowledgeMatch, type KnowledgeRecord } from "./knowledge.js";
import {
  abilityDimensions,
  normalizeIdentity,
  type Assessment,
  type LibraryMaterialScore,
} from "./material-scoring.js";

export function matchMaterialKnowledge(
  material: Pick<LibraryMaterialScore, "materialType" | "materialTitle" | "resumeClaim">,
  records: KnowledgeRecord[],
): string[] {
  const kind =
    material.materialType === "award"
      ? "competition"
      : material.materialType === "research"
        ? "journal"
        : material.materialType === "work" || material.materialType === "project"
          ? "company"
          : null;
  if (!kind) return [];
  const candidates = records.filter((record) => record.kind === kind);
  const title = normalizeIdentity(material.materialTitle);
  const exact = candidates.filter((record) =>
    [record.title, ...record.aliases].some((alias) => normalizeIdentity(alias) === title),
  );
  if (exact.length === 1) return [exact[0].id];
  const matches = candidates.flatMap((record) => {
    const match = findKnowledgeMatch(material.resumeClaim, record);
    return match ? [{ record, match }] : [];
  });
  return matches
    .filter(
      ({ match }) =>
        !matches.some(
          (other) =>
            other.match.length > match.length &&
            normalizeIdentity(other.match).includes(normalizeIdentity(match)),
        ),
    )
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.record.id === item.record.id) === index,
    )
    .map(({ record }) => record.id);
}

export function materialLibraryEntries(
  candidate: { id: string; name: string },
  assessment: Assessment,
): LibraryMaterialScore[] {
  return assessment.materials.map((material) => {
    const abilityContributions = Object.fromEntries(
      abilityDimensions.map(({ key }) => {
        const mapping = material.dimension_mapping[key];
        const term = assessment.abilities[key].terms.find(
          (item) => item.material_id === material.material_id,
        );
        return [
          key,
          {
            score: assessment.abilities[key].score,
            typeCoefficient: mapping.type_coefficient,
            actionCoefficient: mapping.mapping_coefficient,
            derivedContribution: mapping.derived_contribution,
            typeRank: term?.rank ?? null,
            decay: term?.decay ?? null,
            contribution: term?.contribution ?? null,
            reason: mapping.mapping_reason,
            evidence: mapping.supporting_evidence,
          },
        ];
      }),
    ) as LibraryMaterialScore["abilityContributions"];
    return {
      knowledgeIds: [],
      candidateId: candidate.id,
      candidateName: candidate.name,
      assessmentId: assessment.id,
      evaluatedAt: assessment.evaluatedAt,
      scoringVersion: assessment.version,
      materialId: material.material_id,
      materialType: material.material_type,
      materialTitle: material.title,
      year: material.year,
      resumeClaim: material.resume_claim,
      materialScore: material.material_score,
      eventScore: material.event_score,
      performanceRatio: material.performance_ratio,
      performanceBreakdown: material.performance_breakdown,
      scoreCoverage: material.score_coverage,
      provisional: material.provisional,
      missingFactors: material.missing_factors,
      scoreBreakdown: material.score_breakdown,
      sources: material.sources,
      abilityContributions,
    };
  });
}

export function latestMaterialEntries(entries: LibraryMaterialScore[]): LibraryMaterialScore[] {
  const latest = new Map<string, number>();
  for (const entry of entries) {
    const timestamp = Date.parse(entry.evaluatedAt);
    latest.set(
      entry.candidateId,
      Math.max(latest.get(entry.candidateId) ?? 0, Number.isFinite(timestamp) ? timestamp : 0),
    );
  }
  return entries.filter((entry) => {
    const time = Date.parse(entry.evaluatedAt);
    return (Number.isFinite(time) ? time : 0) === latest.get(entry.candidateId);
  });
}

export function materialScoreSummary(entries: LibraryMaterialScore[]) {
  const latest = latestMaterialEntries(entries);
  const known = latest.flatMap((entry) => (entry.materialScore === null ? [] : [entry.materialScore]));
  return {
    entries: latest,
    count: latest.length,
    knownCount: known.length,
    min: known.length ? Math.min(...known) : null,
    max: known.length ? Math.max(...known) : null,
  };
}
