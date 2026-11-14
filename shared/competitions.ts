import database from "../db/competitions.json" with { type: "json" };
import type { KnowledgeRecord } from "./knowledge.js";

export type CompetitionProfile = {
  id: string;
  name: string;
  report_year: number;
  category: string;
  official_website: string | null;
  organizer: string;
  short_info: string;
  info: string;
  influence: string;
  difficulty: string;
  acquires: string[];
  projection: string[];
  sources: Array<{ title: string; url: string }>;
  notes: string;
};

export const competitionCatalog: CompetitionProfile[] = database.records;

export function normalizeCompetitionProfile(input: unknown): CompetitionProfile | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const fields = ["id", "name", "category", "organizer", "short_info", "info", "influence", "difficulty", "notes"] as const;
  if (fields.some((field) => typeof value[field] !== "string" || (value[field] as string).length > 8000)
    || !Number.isInteger(value.report_year) || Number(value.report_year) < 1900 || Number(value.report_year) > 2200) return undefined;
  const url = (input: unknown) => { try { return typeof input === "string" && ["http:", "https:"].includes(new URL(input).protocol); } catch { return false; } };
  if (value.official_website !== null && !url(value.official_website)) return undefined;
  if (["acquires", "projection"].some((field) => !Array.isArray(value[field]) || (value[field] as unknown[]).length > 40
    || (value[field] as unknown[]).some((item) => typeof item !== "string" || item.length > 500))) return undefined;
  if (!Array.isArray(value.sources) || value.sources.length > 40 || value.sources.some((source: unknown) => !source || typeof source !== "object"
    || typeof (source as Record<string, unknown>).title !== "string" || !url((source as Record<string, unknown>).url))) return undefined;
  return {
    ...Object.fromEntries(fields.map((field) => [field, value[field]])),
    report_year: value.report_year as number, official_website: value.official_website as string | null,
    acquires: [...value.acquires as string[]], projection: [...value.projection as string[]],
    sources: (value.sources as CompetitionProfile["sources"]).map(({ title, url }) => ({ title, url })),
  } as CompetitionProfile;
}
const seedIds: Record<string, string> = {
  "2024-01": "competition-china-innovation",
  "2024-02": "competition-challenge-cup",
  "2024-04": "competition-acm-icpc",
  "2024-27": "competition-blue-bridge",
};
const plainName = (value: string) => value.normalize("NFKC").replace(/[\s“”「」『』"'·]/g, "");

export function mergeCompetitionCatalog(seeds: KnowledgeRecord[]): KnowledgeRecord[] {
  const mergedIds = new Set<string>();
  const imported = competitionCatalog.map((competition): KnowledgeRecord => {
    const existing = seeds.find((record) => record.kind === "competition" &&
      (record.id === seedIds[competition.id] || plainName(record.title) === plainName(competition.name)));
    const id = existing?.id ?? `catalog-competition-${competition.id}`;
    if (existing) mergedIds.add(existing.id);
    return {
      ...existing,
      id, kind: "competition", title: competition.name,
      aliases: [...new Set([...(existing?.aliases ?? []), ...(existing ? [existing.title] : []), plainName(competition.name)])].filter((alias) => alias !== competition.name),
      field: competition.category, organizer: competition.organizer, region: existing?.region ?? "",
      summary: competition.short_info, signals: competition.projection,
      officialUrl: competition.official_website ?? "",
      // This placeholder supports the existing review form; no score is inferred from the catalog.
      significanceScore: existing?.significanceScore ?? 50,
      scoreRationale: existing?.scoreRationale ?? "赛事背景资料已整理，尚无人工评分。请结合届次、奖项和岗位证据评估。",
      verificationStatus: existing?.verificationStatus ?? "示例资料，待核验",
      updatedAt: existing?.updatedAt ?? "",
      evidenceSources: competition.sources.map((source, index) => ({
        id: `${id}-source-${index + 1}`, title: source.title, url: source.url,
        sourceType: "other", dataYear: "", verified: false, checkedAt: "",
        note: "来自已整理的赛事资料；目录年份不等于网页内容年份。",
      })),
      competition,
    };
  });
  return [...imported, ...seeds.filter((record) => !mergedIds.has(record.id))];
}

export function competitionSearchText(record: KnowledgeRecord): string {
  const profile = record.competition;
  return [record.title, ...record.aliases, record.field, record.organizer, record.summary, ...record.signals,
    profile?.info, profile?.influence, profile?.difficulty, ...(profile?.acquires ?? []), ...(profile?.projection ?? []), profile?.notes,
    ...(profile?.sources ?? []).map((source) => source.title),
  ].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
}
