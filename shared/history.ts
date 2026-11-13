export type HistoricalCandidate = {
  id: string;
  name: string;
  role: string;
  year: number;
  screened: boolean;
  hired: boolean;
  composite: number;
};

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

export function calculateBenchmark(role: string, score: number, year: number | null = null): Benchmark {
  const group = roleGroup(role);
  const candidates = historicalCandidates.filter((candidate) => roleGroup(candidate.role) === group);
  const roleSample = candidates.length ? candidates : historicalCandidates;
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
