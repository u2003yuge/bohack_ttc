export type HistoricalCandidate = {
  id: string;
  name: string;
  role: string;
  year: number;
  screened: boolean;
  hired: boolean;
  composite: number;
  source?: "demo" | "local";
};

export const historicalScoreBands = [
  { key: "0-19", label: "0–19", min: 0, max: 19 },
  { key: "20-39", label: "20–39", min: 20, max: 39 },
  { key: "40-59", label: "40–59", min: 40, max: 59 },
  { key: "60-79", label: "60–79", min: 60, max: 79 },
  { key: "80-100", label: "80–100", min: 80, max: 100 },
] as const;
export type HistoricalScoreBandKey = (typeof historicalScoreBands)[number]["key"];
export type HistoricalOutcomeFilter = "all" | "hired" | "screened" | "rejected";

export function historicalScoreBand(score: number): HistoricalScoreBandKey | null {
  return historicalScoreBands.find((band) => score >= band.min && score <= band.max)?.key ?? null;
}

export function matchesHistoricalFilters(candidate: HistoricalCandidate, scoreBand: HistoricalScoreBandKey | null, outcome: HistoricalOutcomeFilter): boolean {
  const band = scoreBand ? historicalScoreBands.find((item) => item.key === scoreBand) : null;
  const scoreMatches = !band || (candidate.composite >= band.min && candidate.composite <= band.max);
  const outcomeMatches = outcome === "all"
    || (outcome === "hired" && candidate.hired)
    || (outcome === "screened" && candidate.screened && !candidate.hired)
    || (outcome === "rejected" && !candidate.screened);
  return scoreMatches && outcomeMatches;
}

export function normalizeHistoricalCandidate(input: unknown, id: string, fallbackIndex: number, currentYear = new Date().getFullYear()): HistoricalCandidate | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 80) : "";
  const role = typeof value.role === "string" ? value.role.trim().slice(0, 120) : "";
  const year = Number(value.year);
  const composite = Number(value.composite);
  const screened = value.screened === true;
  const hired = value.hired === true;
  if (!role) return { error: "请填写岗位名称。" };
  if (!Number.isInteger(year) || year < 1980 || year > currentYear + 1) return { error: "请填写有效的招聘年份。" };
  if (!Number.isFinite(composite) || composite < 0 || composite > 100) return { error: "综合分需要在 0 到 100 之间。" };
  if (hired && !screened) return { error: "最终录取样本必须标记为通过首轮。" };
  return { id, name: name || `匿名样本 ${fallbackIndex}`, role, year, screened, hired, composite: Math.round(composite * 10) / 10 };
}

// Seed data for the local recruiting benchmark. Replace with approved historical records in production.
export const historicalCandidates: HistoricalCandidate[] = [
  { id: "hist-product-2024-01", name: "候选人 A", role: "产品经理", year: 2024, screened: true, hired: true, composite: 88 },
  { id: "hist-product-2024-02", name: "候选人 B", role: "产品经理", year: 2024, screened: true, hired: false, composite: 79 },
  { id: "hist-product-2024-03", name: "候选人 C", role: "产品经理", year: 2024, screened: false, hired: false, composite: 62 },
  { id: "hist-product-2025-01", name: "候选人 D", role: "产品经理", year: 2025, screened: true, hired: true, composite: 91 },
  { id: "hist-product-2025-02", name: "候选人 E", role: "产品经理", year: 2025, screened: true, hired: false, composite: 74 },
  { id: "hist-product-2025-03", name: "候选人 F", role: "产品经理", year: 2025, screened: false, hired: false, composite: 58 },
  { id: "hist-data-2024-01", name: "候选人 G", role: "数据分析师", year: 2024, screened: true, hired: true, composite: 86 },
  { id: "hist-data-2024-02", name: "候选人 H", role: "数据分析师", year: 2024, screened: true, hired: false, composite: 71 },
  { id: "hist-data-2025-01", name: "候选人 I", role: "数据分析师", year: 2025, screened: true, hired: true, composite: 93 },
  { id: "hist-frontend-2024-01", name: "候选人 J", role: "前端工程师", year: 2024, screened: true, hired: true, composite: 89 },
  { id: "hist-frontend-2024-02", name: "候选人 K", role: "前端工程师", year: 2024, screened: false, hired: false, composite: 65 },
  { id: "hist-frontend-2025-01", name: "候选人 L", role: "前端工程师", year: 2025, screened: true, hired: false, composite: 77 },
  { id: "hist-engineering-2025-01", name: "候选人 M", role: "软件工程师", year: 2025, screened: true, hired: true, composite: 87 },
  { id: "hist-engineering-2025-02", name: "候选人 N", role: "软件工程师", year: 2025, screened: false, hired: false, composite: 60 },
];

export type Benchmark = {
  roleGroup: string;
  sampleCount: number;
  percentile: number;
  screenCutoff: number;
  hireCutoff: number;
  screenedRate: number;
  hiredRate: number;
  candidates: HistoricalCandidate[];
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
  const group = roleGroup(role);
  const candidates = records.filter((candidate) => roleGroup(candidate.role) === group);
  const roleSample = candidates.length ? candidates : records;
  const availableYears = [...new Set(roleSample.map((candidate) => candidate.year))].sort((a, b) => b - a);
  const yearSample = year === null ? roleSample : roleSample.filter((candidate) => candidate.year === year);
  const sample = yearSample.length ? yearSample : roleSample;
  const activeYear = yearSample.length ? year : null;
  const percentile = Math.round(sample.filter((candidate) => candidate.composite < score).length / sample.length * 100);
  const screened = sample.filter((candidate) => candidate.screened).map((candidate) => candidate.composite).sort((a, b) => a - b);
  const hired = sample.filter((candidate) => candidate.hired).map((candidate) => candidate.composite).sort((a, b) => a - b);
  const allScores = sample.map((candidate) => candidate.composite).sort((a, b) => a - b);
  return {
    roleGroup: group,
    sampleCount: sample.length,
    percentile,
    screenCutoff: percentileValue(screened.length ? screened : allScores),
    hireCutoff: percentileValue(hired.length ? hired : allScores),
    screenedRate: Math.round(sample.filter((candidate) => candidate.screened).length / sample.length * 100),
    hiredRate: Math.round(sample.filter((candidate) => candidate.hired).length / sample.length * 100),
    candidates: sample,
    availableYears,
    year: activeYear,
  };
}

function percentileValue(values: number[]): number {
  return values[Math.max(0, Math.ceil(values.length * 0.5) - 1)] ?? 0;
}
