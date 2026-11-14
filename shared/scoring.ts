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
export type ComparisonRatingFilter = "all" | "scored" | "demo";
export type ComparisonRankDraft = { criterion: ComparisonRankCriterion; direction: "desc" | "asc"; ratingFilter: ComparisonRatingFilter; mapX: ComparisonMapAxis; mapY: ComparisonMapAxis; mapRegion: ComparisonMapRegion; mapThreshold: number; rationale: string };
export type ScoreWeights = Record<ScoreKey, number>;
export type ScoreEvidence = { score: number; evidence: string[]; confidence: number };
export type ScoreCard = {
  criteria: Record<ScoreKey, ScoreEvidence>;
  weights: ScoreWeights;
  composite: number;
  overallConfidence: number;
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
  return Math.round((weightedScore / totalWeight) * 10) / 10;
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
