export const scoreCriteria = [
  { key: "leadership", label: "领导力", description: "带领项目、推动协作、承担责任的可验证证据" },
  { key: "expertise", label: "专业能力", description: "与目标工作相关的技能深度、专业知识和成果" },
  { key: "experience", label: "经验", description: "经历的相关性、复杂度、范围与实际贡献" },
  { key: "perspective", label: "经历广度", description: "与工作相关的行业、领域、方法和团队经历广度" },
  { key: "roleFit", label: "岗位契合度", description: "简历证据与明确岗位要求之间的匹配程度" },
  { key: "growth", label: "进步分", description: "职责、技能或成果随时间发展的简历证据" },
] as const;

export type ScoreKey = (typeof scoreCriteria)[number]["key"];
export type ComparisonRankCriterion = ScoreKey | "composite";
export type ComparisonMapAxis = ScoreKey | "depth";
export type ComparisonMapRegion = "all" | "high-high" | "high-low" | "low-high" | "low-low";
export type ComparisonMapQuadrant = { key: Exclude<ComparisonMapRegion, "all">; x: number; y: number; width: number; height: number; centerX: number; centerY: number };
export type ComparisonRatingFilter = "all" | "scored" | "demo";
export type ComparisonRankDraft = { criterion: ComparisonRankCriterion; direction: "desc" | "asc"; ratingFilter: ComparisonRatingFilter; mapX: ComparisonMapAxis; mapY: ComparisonMapAxis; mapRegion: ComparisonMapRegion; mapThreshold: number; rationale: string };
export type ScoreWeights = Record<ScoreKey, number>;
export type ScoreEvidence = { score: number; evidence: string[]; confidence?: number };
export type ScoreCard = {
  criteria: Record<ScoreKey, ScoreEvidence>;
  weights: ScoreWeights;
  composite: number;
  overallConfidence?: number;
  formula: "weighted-mean-v1";
  evaluatedAt: string;
};

export type ScoreHistoryEntry = {
  id: string;
  evaluatedAt: string;
  reason: "import" | "review";
  roleRequirements?: string;
  scoreCard: ScoreCard;
};

export type GrowthTimelineInput = {
  text: string;
  experiences?: Array<{ role: string; period: string; detail: string }>;
  evaluatedAt?: string;
};

export type GrowthTimelinePoint = {
  year: number;
  score: number;
  annualContribution: number;
  rollingContribution: number;
  windowYears: number;
  evidence: string[];
};

/**
 * Builds a transparent annual growth curve. Each point is the score at the
 * end of that year, based on the contribution in that year and the preceding
 * two years. The final point is scaled to the model's current growth score so
 * the chart and score card remain consistent.
 */
export function calculateGrowthTimeline(input: GrowthTimelineInput, targetScore: number, windowYears = 3): GrowthTimelinePoint[] {
  const safeWindow = Math.max(1, Math.round(windowYears));
  const currentYear = Number.isFinite(Date.parse(input.evaluatedAt ?? ""))
    ? new Date(input.evaluatedAt as string).getFullYear()
    : new Date().getFullYear();
  const text = input.text ?? "";
  const years = new Set<number>();
  const contributions = new Map<number, { points: number; evidence: string[] }>();
  const add = (year: number, points: number, evidence: string) => {
    if (!Number.isFinite(year) || year < 1970 || year > currentYear + 1) return;
    years.add(year);
    const current = contributions.get(year) ?? { points: 0, evidence: [] };
    current.points += points;
    if (evidence && !current.evidence.includes(evidence)) current.evidence.push(evidence.slice(0, 180));
    contributions.set(year, current);
  };
  const parseYears = (value: string) => [...value.matchAll(/(?:19|20)\d{2}/g)].map((match) => Number(match[0]));
  const experiences = input.experiences ?? [];
  for (const experience of experiences) {
    const parsed = parseYears(experience.period);
    const start = parsed[0];
    if (!start) continue;
    const end = parsed[1] ?? currentYear;
    const detail = experience.detail.trim();
    const metricCount = (detail.match(/\d+(?:\.\d+)?\s*%?|\d+\s*(?:人|个|项|家|次|天)/g) ?? []).length;
    const outcomePoints = Math.min(12, metricCount * 3);
    const roleProgression = /(负责人|经理|高级|主管|主导|带领|负责)/.test(experience.role + detail) ? 5 : 2;
    for (let year = start; year <= Math.min(end, currentYear); year += 1) {
      add(year, 8 + outcomePoints + (year === start ? 10 : 0) + roleProgression, `${year}：${experience.role} · ${detail}`);
    }
  }
  const awardPattern = /(奖|获奖|award|acm|icpc|ccpc|kaggle|竞赛|比赛|金牌|银牌|铜牌|一等奖|二等奖|三等奖|优胜|冠军|亚军|季军)/i;
  for (const sentence of text.split(/[。；;\n]/).map((item) => item.trim()).filter(Boolean)) {
    if (!awardPattern.test(sentence)) continue;
    const mentionedYears = parseYears(sentence);
    if (mentionedYears.length) {
      for (const year of mentionedYears) add(year, 15, `奖项：${sentence}`);
    } else if (years.size) {
      add(Math.max(...years), 15, `奖项（年份待核实）：${sentence}`);
    }
  }
  if (!years.size) {
    add(currentYear, Math.max(1, Number(targetScore) || 0), "简历未提取到可解析的年份，当前分数仅作参考");
  }
  const sortedYears = [...years].sort((left, right) => left - right);
  const rawPoints = sortedYears.map((_year, index) => {
    const from = Math.max(0, index - safeWindow + 1);
    return sortedYears.slice(from, index + 1).reduce((sum, item) => sum + (contributions.get(item)?.points ?? 0), 0);
  });
  const latestRaw = rawPoints.at(-1) ?? 0;
  const finalScore = Math.max(0, Number(targetScore) || 0);
  return sortedYears.map((year, index) => {
    const annual = contributions.get(year)?.points ?? 0;
    const rolling = rawPoints[index];
    const score = latestRaw > 0 ? Math.round(rolling / latestRaw * finalScore * 10) / 10 : finalScore;
    const evidence = [...(contributions.get(year)?.evidence ?? [])].slice(0, 4);
    return { year, score, annualContribution: annual, rollingContribution: rolling, windowYears: safeWindow, evidence };
  });
}

export const defaultScoreWeights: ScoreWeights = {
  leadership: 18,
  expertise: 24,
  experience: 20,
  perspective: 10,
  roleFit: 23,
  growth: 5,
};

export function matchesComparisonMapRegion(xScore: number, yScore: number, region: ComparisonMapRegion, threshold = 50): boolean {
  if (region === "all") return true;
  const highX = xScore >= threshold;
  const highY = yScore >= threshold;
  return region === "high-high" ? highX && highY
    : region === "high-low" ? highX && !highY
    : region === "low-high" ? !highX && highY
    : !highX && !highY;
}

export function comparisonMapQuadrants(left: number, top: number, width: number, height: number, threshold: number): ComparisonMapQuadrant[] {
  const lowWidth = width * threshold / 100;
  const highWidth = width - lowWidth;
  const highHeight = height * threshold / 100;
  const lowHeight = height - highHeight;
  const rightX = left + lowWidth;
  const bottomY = top + lowHeight;
  return [
    { key: "low-high", x: left, y: top, width: lowWidth, height: lowHeight, centerX: left + lowWidth / 2, centerY: top + lowHeight / 2 },
    { key: "high-high", x: rightX, y: top, width: highWidth, height: lowHeight, centerX: rightX + highWidth / 2, centerY: top + lowHeight / 2 },
    { key: "low-low", x: left, y: bottomY, width: lowWidth, height: highHeight, centerX: left + lowWidth / 2, centerY: bottomY + highHeight / 2 },
    { key: "high-low", x: rightX, y: bottomY, width: highWidth, height: highHeight, centerX: rightX + highWidth / 2, centerY: bottomY + highHeight / 2 },
  ];
}

export function normalizeComparisonRankDraft(input: unknown, defaults: Partial<ComparisonRankDraft> = {}): ComparisonRankDraft | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const criteria = ["composite", ...scoreCriteria.map(({ key }) => key)];
  const mapAxes = ["depth", ...scoreCriteria.map(({ key }) => key)];
  const criterion = value.criterion === undefined ? defaults.criterion ?? "composite" : value.criterion;
  const direction = value.direction === undefined ? defaults.direction ?? "desc" : value.direction;
  const ratingFilter = value.ratingFilter === undefined ? defaults.ratingFilter ?? "all" : value.ratingFilter;
  const mapX = value.mapX === undefined ? defaults.mapX ?? "perspective" : value.mapX;
  const mapY = value.mapY === undefined ? defaults.mapY ?? "depth" : value.mapY;
  const mapRegion = value.mapRegion === undefined ? defaults.mapRegion ?? "all" : value.mapRegion;
  const mapThreshold = value.mapThreshold === undefined ? defaults.mapThreshold ?? 50 : Number(value.mapThreshold);
  if (!criteria.includes(String(criterion)) || !["asc", "desc"].includes(String(direction)) || !["all", "scored", "demo"].includes(String(ratingFilter))
    || !mapAxes.includes(String(mapX)) || !mapAxes.includes(String(mapY)) || mapX === mapY
    || !["all", "high-high", "high-low", "low-high", "low-low"].includes(String(mapRegion))
    || !Number.isFinite(mapThreshold) || mapThreshold < 20 || mapThreshold > 80) {
    return { error: "排名方案包含无效的评分维度或方向，请重新生成。" };
  }
  return {
    criterion: criterion as ComparisonRankCriterion,
    direction: direction as ComparisonRankDraft["direction"],
    ratingFilter: ratingFilter as ComparisonRatingFilter,
    mapX: mapX as ComparisonMapAxis,
    mapY: mapY as ComparisonMapAxis,
    mapRegion: mapRegion as ComparisonMapRegion,
    mapThreshold: Math.round(mapThreshold),
    rationale: typeof value.rationale === "string" ? value.rationale.trim().slice(0, 240) : "",
  };
}

export function calculateComposite(criteria: Record<ScoreKey, ScoreEvidence>, weights: ScoreWeights): number {
  const totalWeight = scoreCriteria.reduce((total, criterion) => total + weights[criterion.key], 0);
  if (totalWeight <= 0) return 0;
  const weightedScore = scoreCriteria.reduce((total, criterion) => total + criteria[criterion.key].score * weights[criterion.key], 0);
  return Math.round(Math.max(0, weightedScore / totalWeight) * 10) / 10;
}

export function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const total = scoreCriteria.reduce((sum, criterion) => sum + Math.max(0, weights[criterion.key]), 0);
  if (total <= 0) return defaultScoreWeights;
  const raw = scoreCriteria.map((criterion) => ({
    key: criterion.key,
    value: (Math.max(0, weights[criterion.key]) / total) * 100,
  }));
  const normalized = raw.map((item) => ({ ...item, value: Math.floor(item.value) }));
  let remainder = 100 - normalized.reduce((sum, item) => sum + item.value, 0);
  const fractions = raw
    .map((item) => ({ key: item.key, fraction: item.value - Math.floor(item.value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < remainder; index += 1) {
    const key = fractions[index].key;
    const target = normalized.find((item) => item.key === key);
    if (target) target.value += 1;
  }
  return Object.fromEntries(normalized.map((item) => [item.key, item.value])) as ScoreWeights;
}
