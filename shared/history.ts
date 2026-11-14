export type HistoricalCandidate = {
  id: string;
  name: string;
  role: string;
  year: number;
  screened: boolean;
  hired: boolean;
  composite: number | null;
  fileName?: string;
  source?: "demo" | "local";
};

type ScoredHistoricalCandidate = HistoricalCandidate & { composite: number };

/** Supported recruiting benchmark years. Records are created only from reviewed or authorized samples. */
export const historicalYears = [2024, 2025] as const;

export const historicalScoreBands = [
  { key: "0-19", label: "0–19", min: 0, max: 19 },
  { key: "20-39", label: "20–39", min: 20, max: 39 },
  { key: "40-59", label: "40–59", min: 40, max: 59 },
  { key: "60-79", label: "60–79", min: 60, max: 79 },
  { key: "80-100", label: "80–100", min: 80, max: 100 },
] as const;
export type HistoricalScoreBandKey = (typeof historicalScoreBands)[number]["key"];
export type HistoricalOutcomeFilter = "all" | "hired" | "screened" | "rejected";

export type HistoricalFilterOptions = {
  roleGroups: string[];
  years: number[];
};

export type HistoricalFilterDraft = {
  roleGroup: string;
  year: number | "all";
  scoreBand: HistoricalScoreBandKey | "all";
  outcome: HistoricalOutcomeFilter;
  rationale: string;
};

export function normalizeHistoricalFilterDraft(input: unknown, options: HistoricalFilterOptions): HistoricalFilterDraft | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const roleGroup = value.roleGroup === "all" || options.roleGroups.includes(String(value.roleGroup)) ? String(value.roleGroup) : "";
  const year = value.year === "all" ? "all" : Number(value.year);
  const scoreBand = value.scoreBand === "all" || historicalScoreBands.some((band) => band.key === value.scoreBand) ? String(value.scoreBand) : "";
  const outcome = value.outcome;
  if (!roleGroup || (year !== "all" && (!Number.isInteger(year) || !options.years.includes(year))) || !scoreBand || !["all", "hired", "screened", "rejected"].includes(String(outcome))) {
    return { error: "筛选草案包含当前不可用的筛选项，请重新生成。" };
  }
  return {
    roleGroup,
    year,
    scoreBand: scoreBand as HistoricalFilterDraft["scoreBand"],
    outcome: outcome as HistoricalOutcomeFilter,
    rationale: typeof value.rationale === "string" ? value.rationale.trim().slice(0, 240) : "",
  };
}

export function historicalScoreBand(score: number): HistoricalScoreBandKey | null {
  return historicalScoreBands.find((band) => score >= band.min && score <= band.max)?.key ?? null;
}

export function matchesHistoricalFilters(candidate: HistoricalCandidate, scoreBand: HistoricalScoreBandKey | null, outcome: HistoricalOutcomeFilter): boolean {
  const band = scoreBand ? historicalScoreBands.find((item) => item.key === scoreBand) : null;
  const scoreMatches = !band || (candidate.composite !== null && candidate.composite >= band.min && candidate.composite <= band.max);
  const outcomeMatches = outcome === "all"
    || (outcome === "hired" && candidate.hired)
    || (outcome === "screened" && candidate.screened && !candidate.hired)
    || (outcome === "rejected" && !candidate.screened);
  return scoreMatches && outcomeMatches;
}

export function normalizeHistoricalCandidate(input: unknown, id: string, fallbackIndex: number, _currentYear = new Date().getFullYear()): HistoricalCandidate | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 80) : "";
  const role = typeof value.role === "string" ? value.role.trim().slice(0, 120) : "";
  const year = Number(value.year);
  const composite = value.composite === null ? null : Number(value.composite);
  const screened = value.screened === true;
  const hired = value.hired === true;
  if (!role) return { error: "请填写岗位名称。" };
  if (!Number.isInteger(year) || !historicalYears.includes(year as (typeof historicalYears)[number])) return { error: "招聘年份只能选择 2024 或 2025。" };
  if (composite !== null && (!Number.isFinite(composite) || composite < 0 || composite > 100)) return { error: "综合分需要在 0 到 100 之间。" };
  if (hired && !screened) return { error: "最终录取样本必须标记为通过首轮。" };
  return { id, name: name || `匿名样本 ${fallbackIndex}`, role, year, screened, hired, composite: composite === null ? null : Math.round(composite * 10) / 10 };
}

// Seed data for the local recruiting benchmark. Replace with approved historical records in production.
export const historicalCandidates: HistoricalCandidate[] = [];

export type Benchmark = {
  roleGroup: string;
  sampleRoleGroup: string | "all";
  sampleCount: number;
  percentile: number | null;
  screenCutoff: number | null;
  hireCutoff: number | null;
  screenedRate: number;
  hiredRate: number;
  candidates: ScoredHistoricalCandidate[];
  availableYears: number[];
  year: number | null;
};

export function roleGroup(role: string): string {
  const normalized = role.toLowerCase();
  if (/产品|product/.test(normalized)) return "product";
  if (/数据|data|分析|analyst/.test(normalized)) return "data";
  if (/前端|frontend|web/.test(normalized)) return "frontend";
  if (/工程|engineer|开发|developer/.test(normalized)) return "engineering";
  return "general";
}

export function roleGroupLabel(group: string): string {
  return ({ product: "产品", data: "数据分析", frontend: "前端开发", engineering: "软件工程", general: "综合" } as Record<string, string>)[group] ?? "综合";
}

export function calculateBenchmark(role: string, score: number, year: number | null = null, records: HistoricalCandidate[] = historicalCandidates): Benchmark {
  const scoredRecords = records.filter((candidate): candidate is ScoredHistoricalCandidate => typeof candidate.composite === "number" && Number.isFinite(candidate.composite));
  const group = roleGroup(role);
  const candidates = scoredRecords.filter((candidate) => roleGroup(candidate.role) === group);
  const roleSample = candidates.length ? candidates : scoredRecords;
  const availableYears = [...new Set([...historicalYears, ...roleSample.map((candidate) => candidate.year)])].sort((a, b) => b - a);
  const yearSample = year === null ? roleSample : roleSample.filter((candidate) => candidate.year === year);
  const sample = yearSample.length ? yearSample : roleSample;
  const activeYear = yearSample.length ? year : null;
  const percentile = sample.length ? Math.round(sample.filter((candidate) => candidate.composite < score).length / sample.length * 100) : null;
  const screened = sample.filter((candidate) => candidate.screened).map((candidate) => candidate.composite).sort((a, b) => a - b);
  const hired = sample.filter((candidate) => candidate.hired).map((candidate) => candidate.composite).sort((a, b) => a - b);
  return {
    roleGroup: group,
    sampleRoleGroup: candidates.length ? group : "all",
    sampleCount: sample.length,
    percentile,
    screenCutoff: screened.length ? percentileValue(screened) : null,
    hireCutoff: hired.length ? percentileValue(hired) : null,
    screenedRate: sample.length ? Math.round(screened.length / sample.length * 100) : 0,
    hiredRate: sample.length ? Math.round(hired.length / sample.length * 100) : 0,
    candidates: sample,
    availableYears,
    year: activeYear,
  };
}

function percentileValue(values: number[]): number {
  const middle = (values.length - 1) / 2;
  const lower = values[Math.floor(middle)];
  const upper = values[Math.ceil(middle)];
  return lower === undefined || upper === undefined ? 0 : Math.round(((lower + upper) / 2) * 10) / 10;
}
