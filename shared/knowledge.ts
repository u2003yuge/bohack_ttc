import { mergeCompetitionCatalog, normalizeCompetitionProfile, type CompetitionProfile } from "./competitions.js";
import { findVenueMatch, mergeVenueCatalog } from "./venues.js";
import { normalizeVenueProfile, type VenueProfile } from "./venue-profile.js";

export type KnowledgeKind = "competition" | "journal" | "company";
export type KnowledgeReviewEntry = {
  id: string;
  significanceScore: number;
  scoreRationale: string;
  verificationStatus: "示例资料，待核验" | "已核验";
  updatedAt: string;
  source: "manual" | "ai-assisted";
  evidenceSourceIds?: string[];
  evidenceSources?: KnowledgeEvidenceSource[];
};

export function knowledgeReviewTimelineX(dates: string[], left: number, right: number): number[] {
  if (dates.length <= 1) return dates.map(() => (left + right) / 2);
  const timestamps = dates.map((date) => Date.parse(date));
  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp)) || first === last) {
    return dates.map((_, index) => left + index / (dates.length - 1) * (right - left));
  }
  return timestamps.map((timestamp) => left + (timestamp - first) / (last - first) * (right - left));
}

export type KnowledgeEvidenceSourceType = "official" | "school-policy" | "index" | "publisher" | "other";
export type KnowledgeSort = "default" | "score" | "updated" | "title";
export type KnowledgeVerificationFilter = "all" | "pending" | "verified";
export type KnowledgeEvidenceFilter = "all" | "with-sources" | "verified-sources" | "without-sources";
export type KnowledgeScoreBand = "all" | "0-49" | "50-69" | "70-84" | "85-100";
export type KnowledgeReviewFilter = "all" | "reviewed" | "pending";
export type KnowledgeReadiness = "missing-sources" | "sources-pending" | "review-pending" | "complete";
export const knowledgeReadinessStages: Array<{ key: KnowledgeReadiness; label: string; description: string }> = [
  { key: "missing-sources", label: "待补来源", description: "没有资料入口或证据来源" },
  { key: "sources-pending", label: "待核来源", description: "有资料入口，但没有已核证据" },
  { key: "review-pending", label: "待人工评估", description: "有已核来源，尚未完成评分或状态核验" },
  { key: "complete", label: "已完成", description: "有已核来源且已保存人工评估" },
];
export const knowledgeScoreBands: Array<{ key: Exclude<KnowledgeScoreBand, "all">; label: string; min: number; max: number }> = [
  { key: "0-49", label: "0–49", min: 0, max: 49 },
  { key: "50-69", label: "50–69", min: 50, max: 69 },
  { key: "70-84", label: "70–84", min: 70, max: 84 },
  { key: "85-100", label: "85–100", min: 85, max: 100 },
];

export type KnowledgeFilterDraft = {
  kind: KnowledgeKind | "all";
  verificationFilter: KnowledgeVerificationFilter;
  evidenceFilter: KnowledgeEvidenceFilter;
  scoreBand: KnowledgeScoreBand;
  reviewFilter: KnowledgeReviewFilter;
  readiness: KnowledgeReadiness | "all";
  query: string;
  linkedOnly: boolean;
  sort: KnowledgeSort;
  rationale: string;
};

export function normalizeKnowledgeFilterDraft(input: unknown): KnowledgeFilterDraft | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const kinds = ["all", "competition", "journal", "company"];
  const verificationFilters = ["all", "pending", "verified"];
  const evidenceFilters = ["all", "with-sources", "verified-sources", "without-sources"];
  const scoreBands = ["all", "0-49", "50-69", "70-84", "85-100"];
  const reviewFilters = ["all", "reviewed", "pending"];
  const readinessFilters = ["all", ...knowledgeReadinessStages.map((stage) => stage.key)];
  const readiness = value.readiness === undefined ? "all" : value.readiness;
  const sorts = ["default", "score", "updated", "title"];
  if (!kinds.includes(String(value.kind)) || !verificationFilters.includes(String(value.verificationFilter))
    || !evidenceFilters.includes(String(value.evidenceFilter)) || !scoreBands.includes(String(value.scoreBand))
    || !reviewFilters.includes(String(value.reviewFilter)) || !readinessFilters.includes(String(readiness))
    || !sorts.includes(String(value.sort)) || typeof value.linkedOnly !== "boolean") {
    return { error: "筛选草案包含无效选项，请重新生成。" };
  }
  return {
    kind: value.kind as KnowledgeFilterDraft["kind"],
    verificationFilter: value.verificationFilter as KnowledgeVerificationFilter,
    evidenceFilter: value.evidenceFilter as KnowledgeEvidenceFilter,
    scoreBand: value.scoreBand as KnowledgeScoreBand,
    reviewFilter: value.reviewFilter as KnowledgeReviewFilter,
    readiness: readiness as KnowledgeFilterDraft["readiness"],
    query: typeof value.query === "string" ? value.query.trim().slice(0, 120) : "",
    linkedOnly: value.linkedOnly,
    sort: value.sort as KnowledgeSort,
    rationale: typeof value.rationale === "string" ? value.rationale.trim().slice(0, 240) : "",
  };
}

export function summarizeKnowledgeScoreBands(records: KnowledgeRecord[]) {
  return knowledgeScoreBands.map((band) => {
    const items = records.filter((record) => record.significanceScore >= band.min && record.significanceScore <= band.max);
    const reviewed = items.filter((record) => Boolean(record.reviewHistory?.length)).length;
    return { ...band, count: items.length, reviewed, pending: items.length - reviewed };
  });
}

export type KnowledgeEvidenceSource = {
  id: string;
  title: string;
  url: string;
  sourceType: KnowledgeEvidenceSourceType;
  dataYear: string;
  note: string;
  verified: boolean;
  checkedAt: string;
};

export type KnowledgeRecord = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  aliases: string[];
  field: string;
  organizer: string;
  region: string;
  summary: string;
  signals: string[];
  officialUrl: string;
  significanceScore: number;
  scoreRationale: string;
  verificationStatus: "示例资料，待核验" | "已核验";
  updatedAt: string;
  evidenceSources?: KnowledgeEvidenceSource[];
  reviewHistory?: KnowledgeReviewEntry[];
  competition?: CompetitionProfile;
  venue?: VenueProfile;
  origin?: { type: "discovered"; collectedAt: string };
};

export type KnowledgeImportBundle = {
  format: "bohack-knowledge-library";
  version: 1;
  exportedAt?: string;
  records: KnowledgeRecord[];
  reviews?: Record<string, KnowledgeReviewEntry[]>;
};

function normalizeKnowledgeReviewHistory(input: unknown, sources: KnowledgeEvidenceSource[], preserveUnresolvedSourceIds = false): KnowledgeReviewEntry[] {
  return Array.isArray(input) ? input.flatMap((entry): KnowledgeReviewEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const review = entry as Record<string, unknown>;
    const score = typeof review.significanceScore === "number" ? review.significanceScore : Number.NaN;
    const updatedAt = typeof review.updatedAt === "string" && !Number.isNaN(Date.parse(review.updatedAt)) ? review.updatedAt : "";
    if (!Number.isFinite(score) || score < 0 || score > 100 || !updatedAt) return [];
    const evidenceSourceIds = Array.isArray(review.evidenceSourceIds)
      ? review.evidenceSourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string" && (preserveUnresolvedSourceIds || sources.some((source) => source.id === sourceId))).slice(0, 12).map((sourceId) => sourceId.slice(0, 120))
      : [];
    const sourceSnapshots = normalizeKnowledgeEvidenceSources(review.evidenceSources, Array.isArray(review.evidenceSources) ? review.evidenceSources as KnowledgeEvidenceSource[] : []);
    return [{
      id: typeof review.id === "string" && review.id.trim() ? review.id.slice(0, 80) : globalThis.crypto.randomUUID(),
      significanceScore: Math.round(score),
      scoreRationale: typeof review.scoreRationale === "string" ? review.scoreRationale.trim().slice(0, 500) : "",
      verificationStatus: review.verificationStatus === "已核验" ? "已核验" : "示例资料，待核验",
      updatedAt,
      source: review.source === "ai-assisted" ? "ai-assisted" : "manual",
      evidenceSourceIds,
      ...(sourceSnapshots.length ? { evidenceSources: sourceSnapshots } : {}),
    }];
  }).slice(-30) : [];
}

export function normalizeKnowledgeImport(input: unknown): KnowledgeImportBundle | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (value.format !== "bohack-knowledge-library" || value.version !== 1 || !Array.isArray(value.records) || value.records.length > 200) {
    return { error: "文件格式不受支持，或资料数量超过 200 条。" };
  }
  const seen = new Set<string>();
  const records: KnowledgeRecord[] = [];
  for (const [index, item] of value.records.entries()) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim().slice(0, 160) : "";
    const kind = record.kind;
    const score = typeof record.significanceScore === "number" ? record.significanceScore : Number.NaN;
    if (!/^custom-[a-zA-Z0-9-]{8,80}$/.test(id) || seen.has(id) || !title
      || !["competition", "journal", "company"].includes(String(kind)) || !Number.isFinite(score) || score < 0 || score > 100) {
      return { error: "第 " + (index + 1) + " 条资料缺少有效 ID、名称、类别或 0–100 分数；ID 不能重复。" };
    }
    seen.add(id);
    const sources = normalizeKnowledgeEvidenceSources(record.evidenceSources);
    const reviewHistory = normalizeKnowledgeReviewHistory(record.reviewHistory, sources);
    const officialUrl = typeof record.officialUrl === "string" ? record.officialUrl.trim().slice(0, 500) : "";
    let safeOfficialUrl = "";
    try {
      const url = new URL(officialUrl);
      if (url.protocol === "http:" || url.protocol === "https:") safeOfficialUrl = url.toString();
    } catch { /* Ignore malformed import URLs. */ }
    const verificationStatus = record.verificationStatus === "已核验" ? "已核验" : "示例资料，待核验";
    const venue = kind === "journal" ? normalizeVenueProfile(record.venue) : undefined;
    records.push({
      id, kind: kind as KnowledgeKind, title,
      aliases: Array.isArray(record.aliases) ? record.aliases.filter((alias): alias is string => typeof alias === "string").map((alias) => alias.trim().slice(0, 100)).filter(Boolean).slice(0, 8) : [],
      field: typeof record.field === "string" ? record.field.trim().slice(0, 120) : "",
      organizer: typeof record.organizer === "string" ? record.organizer.trim().slice(0, 120) : "",
      region: typeof record.region === "string" ? record.region.trim().slice(0, 80) : "",
      summary: typeof record.summary === "string" ? record.summary.trim().slice(0, 1200) : "",
      signals: Array.isArray(record.signals) ? record.signals.filter((signal): signal is string => typeof signal === "string").map((signal) => signal.trim().slice(0, 100)).filter(Boolean).slice(0, 10) : [],
      officialUrl: safeOfficialUrl,
      significanceScore: Math.round(score),
      scoreRationale: typeof record.scoreRationale === "string" ? record.scoreRationale.trim().slice(0, 500) : "",
      verificationStatus,
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt.slice(0, 40) : new Date().toISOString().slice(0, 10),
      evidenceSources: sources,
      ...(kind === "competition" && normalizeCompetitionProfile(record.competition) ? { competition: normalizeCompetitionProfile(record.competition) } : {}),
      ...(venue ? { venue } : {}),
      ...(record.origin && typeof record.origin === "object" && (record.origin as Record<string, unknown>).type === "discovered"
        && typeof (record.origin as Record<string, unknown>).collectedAt === "string"
        ? { origin: { type: "discovered" as const, collectedAt: String((record.origin as Record<string, unknown>).collectedAt).slice(0, 40) } } : {}),
      ...(reviewHistory.length ? { reviewHistory } : {}),
    });
  }
  const reviewsInput = value.reviews && typeof value.reviews === "object" ? value.reviews as Record<string, unknown> : {};
  const builtInIds = new Set(knowledgeRecords.map((record) => record.id));
  const reviews: Record<string, KnowledgeReviewEntry[]> = {};
  for (const [id, history] of Object.entries(reviewsInput)) {
    if (!builtInIds.has(id)) return { error: "备份包含无效的内置资料评估 ID。" };
    const normalizedHistory = normalizeKnowledgeReviewHistory(history, [], true);
    if (normalizedHistory.length) reviews[id] = normalizedHistory;
  }
  return {
    format: "bohack-knowledge-library",
    version: 1,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt.slice(0, 40) : undefined,
    records,
    ...(Object.keys(reviews).length ? { reviews } : {}),
  };
}

export function getKnowledgeReadiness(record: KnowledgeRecord): KnowledgeReadiness {
  const sources = record.evidenceSources ?? [];
  if (!record.officialUrl && sources.length === 0) return "missing-sources";
  if (!sources.some((source) => source.verified)) return "sources-pending";
  if (!record.reviewHistory?.length || record.verificationStatus !== "已核验") return "review-pending";
  return "complete";
}

export function summarizeKnowledgeReadiness(records: KnowledgeRecord[]) {
  return knowledgeReadinessStages.map((stage) => ({
    ...stage,
    count: records.filter((record) => getKnowledgeReadiness(record) === stage.key).length,
  }));
}

export const knowledgeEvidenceSourceTypeLabels: Record<KnowledgeEvidenceSourceType, string> = {
  official: "官方来源",
  "school-policy": "学校 / 学院文件",
  index: "数据库 / 目录",
  publisher: "出版方 / 主办方",
  other: "其他来源",
};

export function normalizeKnowledgeEvidenceSources(input: unknown, previousSources: KnowledgeEvidenceSource[] = []): KnowledgeEvidenceSource[] {
  if (!Array.isArray(input)) return [];
  const validTypes = Object.keys(knowledgeEvidenceSourceTypeLabels) as KnowledgeEvidenceSourceType[];
  const previousById = new Map(previousSources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  return input.flatMap((item): KnowledgeEvidenceSource[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const title = typeof value.title === "string" ? value.title.trim().slice(0, 160) : "";
    const urlValue = typeof value.url === "string" ? value.url.trim().slice(0, 500) : "";
    let url = "";
    try {
      const parsed = new URL(urlValue);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.toString();
    } catch { /* Ignore malformed URLs. */ }
    if (!title || !url || seen.has(url)) return [];
    seen.add(url);
    const id = typeof value.id === "string" && value.id.trim() ? value.id.slice(0, 80) : globalThis.crypto.randomUUID();
    const sourceType = validTypes.includes(value.sourceType as KnowledgeEvidenceSourceType) ? value.sourceType as KnowledgeEvidenceSourceType : "other";
    const dataYear = typeof value.dataYear === "string" ? value.dataYear.trim().slice(0, 40) : "";
    const previous = previousById.get(id);
    const changedIdentity = Boolean(previous && (previous.title !== title || previous.url !== url || previous.sourceType !== sourceType || previous.dataYear !== dataYear));
    const verified = value.verified === true && !changedIdentity;
    const suppliedCheckDate = typeof value.checkedAt === "string" && !Number.isNaN(Date.parse(value.checkedAt)) ? value.checkedAt : "";
    const checkedAt = verified ? suppliedCheckDate || new Date().toISOString() : "";
    return [{
      id,
      title,
      url,
      sourceType,
      dataYear,
      note: typeof value.note === "string" ? value.note.trim().slice(0, 500) : "",
      verified,
      checkedAt: verified ? checkedAt : "",
    }];
  }).slice(0, 12);
}

export const knowledgeKindLabels: Record<KnowledgeKind, string> = {
  competition: "竞赛",
  journal: "期刊 / 会议",
  company: "公司",
};

export function findKnowledgeMatch(text: string, record: KnowledgeRecord): string | null {
  if (record.venue) return findVenueMatch(text, record);
  const lowerText = text.toLocaleLowerCase();
  for (const term of [record.title, ...record.aliases].sort((left, right) => right.length - left.length)) {
    const candidate = term.trim();
    if (!candidate) continue;
    const lowerCandidate = candidate.toLocaleLowerCase();
    let index = lowerText.indexOf(lowerCandidate);
    while (index >= 0) {
      const previous = Array.from(text.slice(0, index)).at(-1) ?? "";
      const next = Array.from(text.slice(index + candidate.length))[0] ?? "";
      const isLatinOrNumber = (character: string) => /[\p{Script=Latin}\p{N}]/u.test(character);
      if (!isLatinOrNumber(previous) && !isLatinOrNumber(next)) return text.slice(index, index + candidate.length);
      index = lowerText.indexOf(lowerCandidate, index + 1);
    }
  }
  return null;
}

export type KnowledgeDuplicateMatch = {
  record: KnowledgeRecord;
  reason: "exact-name" | "competition-series" | "official-url";
};

const competitionEditionWords = /(?:19|20)\d{2}年?|第[一二三四五六七八九十百千万0-9]+届|总决赛|决赛|复赛|初赛|省赛|市赛|校赛|区域赛|分赛站|赛站|赛区|全国赛|国际赛|华东赛区|华南赛区|华北赛区|西南赛区|东北赛区|华中赛区|东部赛区|西部赛区/g;

function competitionIdentityText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(competitionEditionWords, "").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function httpIdentity(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.toLocaleLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch { return ""; }
}

export function findKnowledgeDuplicate(candidate: Pick<KnowledgeRecord, "kind" | "title"> & Partial<Pick<KnowledgeRecord, "aliases" | "organizer" | "officialUrl" | "field" | "region" | "competition">>, records: KnowledgeRecord[], ignoreId?: string): KnowledgeDuplicateMatch | undefined {
  if (candidate.kind !== "competition") return undefined;
  const candidateNames = [candidate.title, ...(candidate.aliases ?? []), candidate.competition?.name ?? ""].map((value) => value.trim()).filter(Boolean);
  const exactNames = new Set(candidateNames.map((value) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")));
  const candidateSeries = new Set(candidateNames.map(competitionIdentityText).filter((value) => value.length >= 4));
  const candidateUrl = httpIdentity(candidate.officialUrl ?? "");
  for (const record of records) {
    if (record.id === ignoreId || record.kind !== "competition") continue;
    const recordNames = [record.title, ...record.aliases, record.competition?.name ?? ""].map((value) => value.trim()).filter(Boolean);
    const recordExactNames = recordNames.map((value) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""));
    if (recordExactNames.some((name) => exactNames.has(name))) return { record, reason: "exact-name" };
    const recordSeries = recordNames.map(competitionIdentityText).filter((value) => value.length >= 4);
    if (recordSeries.some((recordName) => [...candidateSeries].some((candidateName) => candidateName === recordName || candidateName.includes(recordName) || recordName.includes(candidateName)))) return { record, reason: "competition-series" };
    if (candidateUrl && [record.officialUrl, record.competition?.official_website ?? ""].map(httpIdentity).includes(candidateUrl)) return { record, reason: "official-url" };
  }
  return undefined;
}

export function findKnowledgeReferences(text: string, records: KnowledgeRecord[]): KnowledgeRecord[] {
  return records
    .map((record, index) => ({ record, index, match: findKnowledgeMatch(text, record) }))
    .filter((item): item is { record: KnowledgeRecord; index: number; match: string } => item.match !== null)
    .sort((left, right) => right.match.length - left.match.length || left.index - right.index)
    .slice(0, 6)
    .map(({ record }) => record);
}

export function findCompetitionBackground(text: string, records = knowledgeRecords) {
  return findKnowledgeReferences(text, records.filter((record) => Boolean(record.competition))).map((record) => ({
    knowledgeId: record.id, source: record.origin ? "自动整理的本地赛事资料（非个人获奖证明）" : "competitions.md（本地整理资料，未进行本次联网核验）", ...record.competition!,
  }));
}

export function findVenueBackground(text: string, records = knowledgeRecords) {
  return findKnowledgeReferences(text, records.filter((record) => Boolean(record.venue))).map((record) => ({
    knowledgeId: record.id, source: record.origin ? "自动整理的本地期刊会议资料（非论文发表证明）" : "papers.md（本地整理资料，未进行本次联网核验）",
    matchedText: findKnowledgeMatch(text, record), matchStatus: "渠道名称线索，论文、年份、文种及个人贡献仍需核验", ...record.venue!,
  }));
}

// Local seed records. The score is an explainable human-review starting point, not an objective ranking.
export const demoKnowledgeRecords: KnowledgeRecord[] = [
  { id: "competition-acm-icpc", kind: "competition", title: "ICPC 国际大学生程序设计竞赛", aliases: ["ACM-ICPC", "ICPC"], field: "计算机 / 算法", organizer: "ICPC Foundation", region: "国际", summary: "以团队协作和算法编程能力为核心的大学生程序设计竞赛。", signals: ["团队协作", "算法与数据结构", "限时解题", "国际赛制"], officialUrl: "https://icpc.global/", significanceScore: 92, scoreRationale: "专业相关性强，能够提供算法能力和高压协作的直接证据；仍需核对赛区、名次和年份。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-ccpc", kind: "competition", title: "中国大学生程序设计竞赛", aliases: ["CCPC"], field: "计算机 / 算法", organizer: "中国大学生程序设计竞赛组委会", region: "中国", summary: "面向高校学生的程序设计竞赛，常用于观察算法基础和团队解题能力。", signals: ["算法", "编程实现", "团队协作", "区域赛 / 总决赛"], officialUrl: "https://ccpc.io/", significanceScore: 86, scoreRationale: "与软件工程岗位直接相关；评估时要区分参赛、获奖和具体赛区层级。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-kaggle", kind: "competition", title: "Kaggle 竞赛", aliases: ["Kaggle", "Kaggle competitions"], field: "数据科学 / 机器学习", organizer: "Kaggle", region: "国际", summary: "通过公开数据集和排名机制评估建模、特征处理和实验能力的平台型竞赛。", signals: ["数据建模", "实验迭代", "公开排名", "复现与解释"], officialUrl: "https://www.kaggle.com/competitions", significanceScore: 82, scoreRationale: "能体现数据实践和竞争结果，但需要核对竞赛规模、名次、团队角色和提交方案。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-mcm", kind: "competition", title: "数学建模竞赛", aliases: ["MCM/ICM", "美国大学生数学建模竞赛"], field: "数学 / 建模 / 分析", organizer: "COMAP", region: "国际", summary: "以现实问题建模、分析论证和书面表达为核心的团队竞赛。", signals: ["问题抽象", "定量分析", "团队分工", "报告表达"], officialUrl: "https://www.comap.com/contests/mcm-icm", significanceScore: 78, scoreRationale: "对分析和结构化表达有参考价值；与岗位匹配度取决于岗位是否需要建模或研究能力。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-challenge-cup", kind: "competition", title: "挑战杯全国大学生课外学术科技作品竞赛", aliases: ["挑战杯", "小挑"], field: "创新实践 / 学术科技", organizer: "共青团中央等单位", region: "中国", summary: "面向高校学生的学术科技作品竞赛，包含作品研究、团队协作和答辩展示等环节。", signals: ["作品实际完成度", "个人贡献", "竞赛届次与赛道", "省赛 / 国赛获奖层级"], officialUrl: "https://www.tiaozhanbei.net/", significanceScore: 76, scoreRationale: "示例参考分。需核对具体赛事子项、获奖层级、团队规模及候选人的可验证贡献。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-china-innovation", kind: "competition", title: "中国国际大学生创新大赛", aliases: ["互联网+", "中国国际“互联网+”大学生创新创业大赛"], field: "创新创业 / 产品实践", organizer: "教育部等单位", region: "中国", summary: "面向大学生创新创业项目的竞赛，项目常涉及市场验证、产品方案和团队运营。", signals: ["项目所处阶段", "用户与市场验证", "候选人实际职责", "校赛 / 省赛 / 国赛层级"], officialUrl: "https://cy.ncss.cn/", significanceScore: 74, scoreRationale: "示例参考分。奖项名称不能代替项目真实性审查，需确认项目成果、个人角色和获奖赛道。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-blue-bridge", kind: "competition", title: "蓝桥杯全国软件和信息技术专业人才大赛", aliases: ["蓝桥杯", "Blue Bridge Cup"], field: "计算机 / 软件工程", organizer: "工业和信息化部人才交流中心", region: "中国", summary: "覆盖软件、算法和信息技术方向的竞赛，按赛项和组别组织。", signals: ["具体赛项与组别", "省赛 / 国赛", "获奖等级", "独立完成与代码能力"], officialUrl: "https://dasai.lanqiao.cn/", significanceScore: 69, scoreRationale: "示例参考分。赛项、组别和获奖层级差异较大，须核对证书及官方结果，不能只凭赛事名称判断。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-ccf-bdci", kind: "competition", title: "CCF 大数据与计算智能大赛", aliases: ["CCF BDCI", "BDCI", "CCF大数据竞赛"], field: "数据科学 / 人工智能", organizer: "中国计算机学会", region: "中国", summary: "围绕数据分析和计算智能任务组织的竞赛，通常以公开赛题、模型效果和方案说明作为评价依据。", signals: ["赛题与岗位相关度", "榜单名次及参赛规模", "团队中的个人贡献", "方法可复现性"], officialUrl: "https://www.datafountain.cn/competitions", significanceScore: 72, scoreRationale: "示例参考分。需核对具体赛题、榜单、队伍成员和候选人负责的模型或工程部分。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-nature", kind: "journal", title: "Nature", aliases: ["自然"], field: "综合科学", organizer: "Nature Portfolio", region: "国际", summary: "综合性科学研究出版物，覆盖自然科学多个领域。", signals: ["研究质量", "同行评审", "跨学科影响", "论文贡献"], officialUrl: "https://www.nature.com/", significanceScore: 95, scoreRationale: "通常代表较强研究影响力信号，但必须核对作者贡献、文章类型和是否为正式发表。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-tpami", kind: "journal", title: "IEEE Transactions on Pattern Analysis and Machine Intelligence", aliases: ["IEEE TPAMI", "TPAMI"], field: "人工智能 / 计算机视觉", organizer: "IEEE", region: "国际", summary: "聚焦模式分析、机器智能和计算机视觉等方向的学术期刊。", signals: ["同行评审", "算法研究", "实验验证", "研究影响"], officialUrl: "https://www.computer.org/csdl/journal/tp", significanceScore: 91, scoreRationale: "对 AI 研究岗位具有较强相关性；需要核对论文作者排序、贡献和发表状态。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-neurips", kind: "journal", title: "NeurIPS", aliases: ["Conference on Neural Information Processing Systems"], field: "人工智能 / 机器学习", organizer: "NeurIPS Foundation", region: "国际", summary: "机器学习和人工智能领域的重要学术会议之一。", signals: ["研究创新", "同行评审", "模型与实验", "公开交流"], officialUrl: "https://neurips.cc/", significanceScore: 92, scoreRationale: "对机器学习研究经历有较强参考价值；需区分正式接收、workshop、poster 和共同作者贡献。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-cvpr", kind: "journal", title: "IEEE/CVF Conference on Computer Vision and Pattern Recognition", aliases: ["CVPR", "IEEE CVPR"], field: "人工智能 / 计算机视觉", organizer: "IEEE / Computer Vision Foundation", region: "国际", summary: "计算机视觉领域的学术会议，论文通常围绕视觉算法、数据集和实验结果展开。", signals: ["正式论文还是 workshop", "作者排序与实际贡献", "研究问题和实验质量", "发表年份及录用状态"], officialUrl: "https://cvpr.thecvf.com/", significanceScore: 90, scoreRationale: "示例参考分。需要区分主会论文与 workshop 等形式，并核验论文页面及作者贡献。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-acl", kind: "journal", title: "Annual Meeting of the Association for Computational Linguistics", aliases: ["ACL", "ACL 主会"], field: "自然语言处理 / 计算语言学", organizer: "Association for Computational Linguistics", region: "国际", summary: "自然语言处理与计算语言学领域的学术会议，发表研究论文和相关学术成果。", signals: ["主会 / Findings / workshop 类型", "录用年份", "作者贡献", "研究与岗位的相关程度"], officialUrl: "https://www.aclweb.org/", significanceScore: 89, scoreRationale: "示例参考分。应核验论文所属轨道与正式发表记录，不能把 workshop 或投稿状态视为主会录用。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-ieee-tse", kind: "journal", title: "IEEE Transactions on Software Engineering", aliases: ["IEEE TSE", "TSE"], field: "软件工程 / 系统研究", organizer: "IEEE", region: "国际", summary: "关注软件工程方法、工具、过程和实证研究的同行评审期刊。", signals: ["论文类型与正式卷期", "研究方法和实证质量", "作者贡献", "期刊收录信息及年份"], officialUrl: "https://www.computer.org/csdl/journal/ts", significanceScore: 87, scoreRationale: "示例参考分。需结合岗位相关性、正式发表状态和可核验的作者贡献进行人工判断。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-kdd", kind: "journal", title: "ACM SIGKDD Conference on Knowledge Discovery and Data Mining", aliases: ["KDD", "ACM SIGKDD"], field: "数据挖掘 / 机器学习", organizer: "ACM SIGKDD", region: "国际", summary: "数据挖掘与知识发现领域的学术会议，涉及算法、应用和数据驱动研究。", signals: ["主会或 workshop", "论文录用信息", "作者贡献", "实验可复现性"], officialUrl: "https://kdd.org/", significanceScore: 88, scoreRationale: "示例参考分。需要确认正式会议论文、作者贡献和研究方向与岗位的相关程度。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-alibaba", kind: "company", title: "阿里巴巴", aliases: ["Alibaba"], field: "互联网 / 电商 / 云计算", organizer: "阿里巴巴集团", region: "中国", summary: "大型互联网企业，业务覆盖电商、云计算和数字服务等方向。", signals: ["业务规模", "复杂系统", "跨团队协作", "平台经验"], officialUrl: "https://www.alibabagroup.com/", significanceScore: 84, scoreRationale: "公司经历本身不能替代个人能力判断，应重点核对具体团队、职责、项目结果和个人贡献。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-tencent", kind: "company", title: "腾讯", aliases: ["Tencent"], field: "互联网 / 社交 / 游戏 / 云服务", organizer: "腾讯", region: "中国", summary: "大型科技企业，业务涵盖社交、数字内容、游戏和企业服务等方向。", signals: ["产品规模", "工程协作", "用户产品", "业务复杂度"], officialUrl: "https://www.tencent.com/", significanceScore: 84, scoreRationale: "品牌只提供背景信号，最终要回到岗位相关的可验证成果和面试追问。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-huawei", kind: "company", title: "华为", aliases: ["Huawei"], field: "通信 / ICT / 企业服务", organizer: "华为", region: "中国", summary: "面向通信、信息与通信技术和企业服务的科技企业。", signals: ["技术研发", "工程交付", "大型组织协作", "全球业务"], officialUrl: "https://www.huawei.com/", significanceScore: 83, scoreRationale: "可作为技术和大型项目环境的背景参考，不能仅凭公司名称推断个人能力。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-startup-example", kind: "company", title: "星桥科技（示例）", aliases: ["Starbridge Tech"], field: "企业软件 / SaaS", organizer: "公开资料示例", region: "中国", summary: "用于演示早期公司经历如何结合产品阶段、职责范围和业务结果进行判断。", signals: ["职责跨度", "从 0 到 1", "快速迭代", "资源约束"], officialUrl: "", significanceScore: 70, scoreRationale: "早期公司经历的价值取决于职责边界和结果证据，不能用公司知名度简单替代。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-bytedance", kind: "company", title: "字节跳动", aliases: ["ByteDance", "TikTok 母公司"], field: "互联网 / 内容平台 / 企业服务", organizer: "字节跳动", region: "中国 / 国际", summary: "科技公司，业务包括内容平台、企业服务和相关技术产品；实际经历价值与具体业务和团队职责有关。", signals: ["所在业务与产品阶段", "个人职责边界", "可量化业务或技术结果", "跨团队协作范围"], officialUrl: "https://www.bytedance.com/", significanceScore: 82, scoreRationale: "示例参考分。公司名称只提供组织背景，不推断候选人能力；核查具体团队、职级、职责和项目结果。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-microsoft", kind: "company", title: "微软", aliases: ["Microsoft"], field: "软件 / 云计算 / 人工智能", organizer: "Microsoft Corporation", region: "国际", summary: "覆盖软件、云平台、开发者工具和人工智能等业务的科技公司。", signals: ["具体产品线和团队", "个人负责的系统范围", "工程质量与业务影响", "实习 / 外包 / 正式岗位类型"], officialUrl: "https://www.microsoft.com/", significanceScore: 83, scoreRationale: "示例参考分。品牌不能替代职责核验，应确认雇佣关系、团队、工作范围和候选人的实际贡献。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-dji", kind: "company", title: "大疆创新", aliases: ["DJI", "DJI Technology"], field: "机器人 / 无人机 / 消费电子", organizer: "深圳市大疆创新科技有限公司", region: "中国", summary: "以无人机及相关影像、机器人和智能硬件产品闻名的科技公司。", signals: ["硬件与软件的协作内容", "产品交付和质量指标", "候选人负责的技术模块", "商业或用户影响"], officialUrl: "https://www.dji.com/", significanceScore: 77, scoreRationale: "示例参考分。应结合具体研发方向、项目交付及个人可验证成果评估，不按公司名气直接赋分。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-catl", kind: "company", title: "宁德时代", aliases: ["CATL", "宁德时代新能源科技股份有限公司"], field: "新能源 / 电池 / 制造", organizer: "宁德时代新能源科技股份有限公司", region: "中国 / 国际", summary: "新能源科技企业，业务覆盖动力电池、储能和相关制造及研发活动。", signals: ["研发 / 制造 / 供应链等岗位类型", "负责产品或工艺范围", "质量、安全与效率结果", "数据和项目证据"], officialUrl: "https://www.catl.com/", significanceScore: 76, scoreRationale: "示例参考分。公司背景不等同于个人技术水平，应核实具体岗位、项目职责和量化成果。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
];

export const knowledgeRecords: KnowledgeRecord[] = mergeVenueCatalog(mergeCompetitionCatalog(demoKnowledgeRecords));
