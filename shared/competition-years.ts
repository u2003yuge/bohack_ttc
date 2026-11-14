import database from "../db/competition-years.json" with { type: "json" };

export type CompetitionYearMetric = { reported: string; unit: string; scope: string };
export type CompetitionYear = {
  edition: string | null;
  status: string | null;
  status_basis: string | null;
  participants: CompetitionYearMetric | null;
  award_categories?: string[] | null;
  award_rate: string | null;
  awards: CompetitionYearMetric | null;
  bonuses: { reported: string; currency: string; scope: string } | null;
  sources: Array<{ title: string; url: string }>;
  notes: string;
};
export type CompetitionHistory = {
  id: string;
  name: string;
  official_website: string | null;
  checked_at: string;
  years: Record<string, CompetitionYear>;
  notes: string;
};

const isText = (value: unknown, max = 8000): value is string => typeof value === "string" && value.length <= max;
const nullableText = (value: unknown) => value === null || isText(value);
const isUrl = (value: unknown) => {
  try { return typeof value === "string" && value.length <= 2000 && ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
};
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizeCompetitionHistory(input: unknown): CompetitionHistory | undefined {
  if (!isObject(input) || !isText(input.id, 160) || !isText(input.name, 500) || !input.id || !input.name
    || (input.official_website !== null && !isUrl(input.official_website))
    || !isText(input.checked_at, 40) || !/^\d{4}-\d{2}-\d{2}$/.test(input.checked_at)
    || !isText(input.notes) || !isObject(input.years) || Object.keys(input.years).length > 100) return undefined;
  const years: Record<string, CompetitionYear> = {};
  for (const [year, entry] of Object.entries(input.years)) {
    if (!/^(19|20|21)\d{2}$/.test(year) || !isObject(entry)
      || !["edition", "status", "status_basis", "award_rate"].every((key) => nullableText(entry[key]))
      || !isText(entry.notes) || !Array.isArray(entry.sources) || entry.sources.length > 40
      || !entry.sources.every((source) => isObject(source) && isText(source.title, 500) && isUrl(source.url))) return undefined;
    if (entry.award_categories !== undefined && entry.award_categories !== null
      && (!Array.isArray(entry.award_categories) || entry.award_categories.length > 100
        || !entry.award_categories.every((category) => isText(category, 500)))) return undefined;
    for (const [key, unit] of [["participants", "unit"], ["awards", "unit"], ["bonuses", "currency"]]) {
      const metric = entry[key];
      if (metric !== null && (!isObject(metric) || !isText(metric.reported) || !isText(metric[unit], 100) || !isText(metric.scope))) return undefined;
    }
    const metric = (value: unknown) => value === null ? null : { reported: (value as CompetitionYearMetric).reported, unit: (value as CompetitionYearMetric).unit, scope: (value as CompetitionYearMetric).scope };
    const bonuses = entry.bonuses as CompetitionYear["bonuses"];
    years[year] = {
      edition: entry.edition as string | null, status: entry.status as string | null,
      status_basis: entry.status_basis as string | null, participants: metric(entry.participants),
      award_rate: entry.award_rate as string | null, awards: metric(entry.awards),
      ...(entry.award_categories !== undefined ? { award_categories: entry.award_categories === null ? null : [...entry.award_categories as string[]] } : {}),
      bonuses: bonuses ? { reported: bonuses.reported, currency: bonuses.currency, scope: bonuses.scope } : null,
      sources: entry.sources.map((source) => ({ title: source.title as string, url: source.url as string })),
      notes: entry.notes,
    };
  }
  return { id: input.id, name: input.name, official_website: input.official_website as string | null,
    checked_at: input.checked_at, years, notes: input.notes };
}

export const competitionHistories: CompetitionHistory[] = database.records.map((record) => {
  const history = normalizeCompetitionHistory(record);
  if (!history) throw new Error(`年度赛事资料格式无效：${record.id}`);
  return history;
});

export function competitionYearHasInformation(entry: CompetitionYear): boolean {
  return Boolean(entry.edition?.trim() || entry.status?.trim() || entry.status_basis?.trim()
    || entry.participants?.reported.trim() || entry.award_categories?.some((category) => category.trim())
    || entry.award_rate?.trim() || entry.awards?.reported.trim() || entry.bonuses?.reported.trim()
    || entry.sources.length);
}

export function competitionHistorySearchText(history?: CompetitionHistory): string {
  if (!history) return "";
  return [history.checked_at, history.notes, ...Object.entries(history.years).flatMap(([year, entry]) => [
    year, entry.edition, entry.status, entry.status_basis, entry.participants?.reported, entry.participants?.unit, entry.participants?.scope,
    ...(entry.award_categories ?? []), entry.award_rate, entry.awards?.reported, entry.awards?.unit, entry.awards?.scope,
    entry.bonuses?.reported, entry.bonuses?.currency, entry.bonuses?.scope, entry.notes, ...entry.sources.map((source) => source.title),
  ])].filter(Boolean).join(" ");
}
