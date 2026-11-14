export type VenueRanking = {
  system: string;
  issuer: string;
  edition: string;
  year: number;
  category: string;
  rank: string;
  applies_to: string;
  source_url: string;
  source_pages?: number[];
  verification: string;
};

export type VenueProfile = {
  id: string;
  name: string;
  abbreviation: string;
  aliases: string[];
  type: "期刊" | "会议";
  scope: string;
  field: string[];
  publisher_or_organizer: string;
  official_website: string;
  short_info: string;
  info: string;
  influence: string;
  difficulty: string;
  rankings: VenueRanking[];
  ranking_note: string;
  annual_metrics: null;
  indexing: null;
  sources: Array<{ title: string; url: string; information: string; access: string; source_type: string }>;
  checked_on: string;
  notes: string[];
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 10000): value is string => typeof value === "string" && value.length <= max;
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 60 && value.every((item) => text(item, 1500));
const http = (value: unknown) => { try { return text(value, 2000) && ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } };

// The current catalog deliberately leaves annual metrics and indexing unverified (null).
export function normalizeVenueProfile(input: unknown): VenueProfile | undefined {
  if (!object(input)) return undefined;
  const fields = ["id", "name", "abbreviation", "scope", "publisher_or_organizer", "short_info", "info", "influence", "difficulty", "ranking_note", "checked_on"] as const;
  if (fields.some((key) => !text(input[key])) || !String(input.id).trim() || !String(input.name).trim()
    || !["期刊", "会议"].includes(String(input.type)) || !http(input.official_website)
    || !list(input.aliases) || !list(input.field) || !input.field.length || !list(input.notes)
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.checked_on)) || !Number.isFinite(Date.parse(String(input.checked_on)))
    || input.annual_metrics !== null || input.indexing !== null) return undefined;
  if (!Array.isArray(input.rankings) || input.rankings.length > 20 || input.rankings.some((ranking) => !object(ranking)
    || ["system", "issuer", "edition", "category", "rank", "applies_to", "verification"].some((key) => !text(ranking[key]))
    || !Number.isInteger(ranking.year) || Number(ranking.year) < 1900 || Number(ranking.year) > 2200 || !http(ranking.source_url)
    || (ranking.source_pages !== undefined && (!Array.isArray(ranking.source_pages) || ranking.source_pages.length > 100 || ranking.source_pages.some((page) => !Number.isInteger(page) || page < 1))))) return undefined;
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 40 || input.sources.some((source) => !object(source)
    || ["title", "information", "access", "source_type"].some((key) => !text(source[key])) || !http(source.url))) return undefined;
  return {
    ...Object.fromEntries(fields.map((key) => [key, input[key]])), type: input.type,
    aliases: [...input.aliases], field: [...input.field], notes: [...input.notes], official_website: input.official_website,
    annual_metrics: null, indexing: null,
    rankings: input.rankings.map((ranking) => ({
      system: ranking.system, issuer: ranking.issuer, edition: ranking.edition, year: ranking.year,
      category: ranking.category, rank: ranking.rank, applies_to: ranking.applies_to, source_url: ranking.source_url,
      verification: ranking.verification, ...(ranking.source_pages ? { source_pages: [...ranking.source_pages] } : {}),
    })),
    sources: input.sources.map(({ title, url, information, access, source_type }) => ({ title, url, information, access, source_type })),
  } as VenueProfile;
}
