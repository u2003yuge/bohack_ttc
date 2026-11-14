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

export type VenueImpactFactor = {
  metric: string;
  years: Record<string, number | null>;
  status: "verified" | "partial" | "not_found" | "not_applicable";
  source_scope: string;
  sources: Array<{ title: string; url: string; information: string }>;
  checked_on: string;
  notes: string;
};

export type VenueLogo = {
  path: string | null;
  format: string | null;
  source_url: string;
  status: "downloaded" | "fallback_favicon" | "not_found";
  notes: string;
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
  impact_factor?: VenueImpactFactor;
  logo?: VenueLogo;
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 10000): value is string => typeof value === "string" && value.length <= max;
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 60 && value.every((item) => text(item, 1500));
const http = (value: unknown) => { try { return text(value, 2000) && ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } };
const date = (value: unknown) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

export function normalizeVenueImpactFactor(input: unknown): VenueImpactFactor | undefined {
  if (!object(input) || !text(input.metric) || !input.metric.trim() || !text(input.source_scope) || !text(input.notes)
    || !["verified", "partial", "not_found", "not_applicable"].includes(String(input.status)) || !date(input.checked_on)
    || !object(input.years) || !Object.keys(input.years).length || Object.keys(input.years).length > 10
    || Object.entries(input.years).some(([year, value]) => !/^\d{4}$/.test(year) || +year < 1900 || +year > 2200
      || (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)))
    || !Array.isArray(input.sources) || input.sources.length > 40 || input.sources.some((source) => !object(source)
      || !text(source.title) || !text(source.information) || !http(source.url))) return undefined;
  const hasValues = Object.values(input.years).some((value) => value !== null);
  if ((hasValues && !input.sources.length) || (["not_found", "not_applicable"].includes(String(input.status)) && hasValues)) return undefined;
  return { metric: input.metric, years: { ...input.years }, status: input.status as VenueImpactFactor["status"],
    source_scope: input.source_scope, checked_on: input.checked_on, notes: input.notes,
    sources: input.sources.map(({ title, url, information }) => ({ title, url, information })) } as VenueImpactFactor;
}

export function normalizeVenueLogo(input: unknown): VenueLogo | undefined {
  if (!object(input) || !["downloaded", "fallback_favicon", "not_found"].includes(String(input.status))
    || !http(input.source_url) || !text(input.notes)) return undefined;
  if (input.status === "not_found") {
    if (input.path !== null || input.format !== null) return undefined;
  } else if (!text(input.path, 180) || !/^papers_logo\/[a-z0-9][a-z0-9-]*\.(?:png|ico|jpg|jpeg|webp|gif|bmp|bin)$/.test(input.path)
    || !text(input.format, 10) || input.path.split(".").at(-1) !== input.format) return undefined;
  return { path: input.path, format: input.format, source_url: input.source_url, status: input.status, notes: input.notes } as VenueLogo;
}

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
  const impact = input.impact_factor === undefined ? undefined : normalizeVenueImpactFactor(input.impact_factor);
  const logo = input.logo === undefined ? undefined : normalizeVenueLogo(input.logo);
  if ((input.impact_factor !== undefined && !impact) || (input.logo !== undefined && !logo)) return undefined;
  if (impact && ((input.type === "会议") !== (impact.status === "not_applicable"))) return undefined;
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
    ...(impact ? { impact_factor: impact } : {}), ...(logo ? { logo } : {}),
  } as VenueProfile;
}
