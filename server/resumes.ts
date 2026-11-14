import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { enrichKnowledgeDraft, suggestComparisonRanking, suggestHistoricalFilters, suggestKnowledgeAssessment, suggestKnowledgeFilters, suggestScoreWeights } from "./analysis.js";
import { resumeAnalysisAgentIds, runResumeAgents, type AgentArtifact, type ResumeAgentId } from "./agents/registry.js";
import { respondWithAnalysis } from "./analysis-response.js";
import { interruptible } from "./operations.js";
import { defaultScoreWeights, normalizeComparisonRankDraft, normalizeWeights, type ComparisonRankDraft, type ScoreCard, type ScoreHistoryEntry, type ScoreWeights } from "../shared/scoring.js";
import { historicalCandidates, normalizeHistoricalCandidate, roleGroup, type HistoricalCandidate, type HistoricalFilterOptions } from "../shared/history.js";
import { knowledgeRecords, normalizeKnowledgeEvidenceSources, normalizeKnowledgeImport, type KnowledgeRecord, type KnowledgeReviewEntry } from "../shared/knowledge.js";
import { searchPublicWeb } from "./web-search.js";
import { catalogStore, readCustomKnowledge, readKnowledgeRecords } from "./knowledge-store.js";
import { assessmentReport, evaluateResume } from "./scoring/pipeline.js";
import type { Assessment, AssessmentHistoryEntry } from "../shared/material-scoring.js";
import type { AnalysisResult, ResearchBatch } from "../src/research-types.js";

type ResumeRecord = {
  id: string;
  fileName: string;
  name: string;
  role: string;
  location: string;
  received: string;
  initials: string;
  source: "pdf";
  text: string;
  education: string;
  skills: string[];
  summary: string;
  analysisReport: string;
  scoreCard?: ScoreCard;
  scoreHistory?: ScoreHistoryEntry[];
  assessment?: Assessment;
  assessmentHistory?: AssessmentHistoryEntry[];
  agentArtifacts?: AgentArtifact[];
  analysisStatus: "complete" | "unavailable" | "failed";
  analysisError: string;
  analyzedAt: string;
  pages: number;
  size: number;
  extractionVersion: number;
};

const directory = path.resolve(process.env.RESUME_DIR || ".data/resumes");
const pdfjsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/pdfjs-dist");
const router = Router();
const maxPdfSize = 30 * 1024 * 1024;
const extractionVersion = 3;
const settingsPath = path.join(directory, ".metadata", "settings.json");
const knowledgeReviewsPath = path.join(directory, ".metadata", "knowledge-reviews.json");
const customKnowledgePath = path.join(directory, ".metadata", "knowledge-records.json");
const historyCandidatesPath = path.join(directory, ".metadata", "history-candidates.json");
const assessmentSaves = new Map<string, Promise<ResumeRecord>>();

router.get("/history", async (_request, response, next) => {
  try {
    const local = await readHistoryCandidates();
    response.json({ candidates: [...historicalCandidates.map((candidate) => ({ ...candidate, source: "demo" as const })), ...local.map((candidate) => ({ ...candidate, source: "local" as const }))], description: "本地历史招聘基准样本" });
  } catch (error) { next(error); }
});

router.post("/history/filter-draft", async (request, response, next) => {
  try {
    const instruction = typeof request.body?.instruction === "string" ? request.body.instruction.trim().slice(0, 500) : "";
    const records = [...historicalCandidates, ...await readHistoryCandidates()];
    const options: HistoricalFilterOptions = {
      roleGroups: [...new Set(records.map((candidate) => roleGroup(candidate.role)))].slice(0, 20),
      years: [...new Set(records.map((candidate) => candidate.year))].sort((left, right) => right - left).slice(0, 30),
    };
    if (!instruction) { response.status(400).json({ error: "请描述希望查看的历史样本。" }); return; }
    if (!process.env.OPENAI_API_KEY) { response.status(503).json({ error: "尚未配置模型服务，无法生成筛选草案。" }); return; }
    const suggestion = await suggestHistoricalFilters(instruction, options);
    response.json({ suggestion });
  } catch (error) { next(error); }
});

router.post("/comparison/rank-draft", async (request, response, next) => {
  try {
    const instruction = typeof request.body?.instruction === "string" ? request.body.instruction.trim().slice(0, 500) : "";
    if (!instruction) { response.status(400).json({ error: "请描述希望按什么能力比较候选人。" }); return; }
    if (!process.env.OPENAI_API_KEY) { response.status(503).json({ error: "尚未配置模型服务，无法生成排名方案。" }); return; }
    const currentDraft = normalizeComparisonRankDraft(request.body?.current ?? {});
    if ("error" in currentDraft) { response.status(400).json({ error: "当前排名或图表设置无效，请刷新后重试。" }); return; }
    const suggestion = await suggestComparisonRanking(instruction, currentDraft as ComparisonRankDraft);
    response.json({ suggestion });
  } catch (error) { next(error); }
});

router.post("/history", async (request, response, next) => {
  try {
    const local = await readHistoryCandidates();
    const candidate = normalizeHistoricalCandidate(request.body, `hist-local-${randomUUID()}`, local.length + 1);
    if ("error" in candidate) { response.status(400).json({ error: candidate.error }); return; }
    local.unshift(candidate);
    await writeHistoryCandidates(local);
    response.status(201).json({ candidate: { ...candidate, source: "local" } });
  } catch (error) { next(error); }
});

router.put("/history/:id", async (request, response, next) => {
  try {
    const local = await readHistoryCandidates();
    const index = local.findIndex((candidate) => candidate.id === request.params.id);
    if (index < 0) { response.status(404).json({ error: "找不到本地历史样本。" }); return; }
    const candidate = normalizeHistoricalCandidate(request.body, local[index].id, index + 1);
    if ("error" in candidate) { response.status(400).json({ error: candidate.error }); return; }
    local[index] = candidate;
    await writeHistoryCandidates(local);
    response.json({ candidate: { ...candidate, source: "local" } });
  } catch (error) { next(error); }
});

router.delete("/history/:id", async (request, response, next) => {
  try {
    const local = await readHistoryCandidates();
    const nextRecords = local.filter((candidate) => candidate.id !== request.params.id);
    if (nextRecords.length === local.length) { response.status(404).json({ error: "找不到本地历史样本。" }); return; }
    await writeHistoryCandidates(nextRecords);
    response.json({ deleted: true });
  } catch (error) { next(error); }
});

router.get("/knowledge", async (request, response, next) => {
  try {
    const reviews = await readKnowledgeReviews();
    const records = await readKnowledgeRecords();
    const kind = request.query.kind;
    if (kind !== undefined && !["competition", "journal", "company"].includes(String(kind))) {
      response.status(400).json({ error: "请选择竞赛、期刊或企业类别。" }); return;
    }
    response.json({ records: records.filter((record) => kind === undefined || record.kind === kind).map((record) => ({ ...record, ...(reviews[record.id] ?? {}) })), source: "local-json" });
  } catch (error) { next(error); }
});

router.get("/knowledge/export", async (_request, response, next) => {
  try {
    const custom = await readCustomKnowledge();
    const reviews = await readKnowledgeReviews();
    const records = custom.map((record) => ({ ...record, ...(reviews[record.id] ?? {}) }));
    const builtInIds = new Set(knowledgeRecords.map((record) => record.id));
    const builtInReviews = Object.fromEntries(Object.entries(reviews)
      .filter(([id, review]) => builtInIds.has(id) && Boolean(review.reviewHistory?.length))
      .map(([id, review]) => [id, review.reviewHistory]));
    response.json({ format: "bohack-knowledge-library", version: 1, exportedAt: new Date().toISOString(), records, reviews: builtInReviews });
  } catch (error) { next(error); }
});

router.post("/knowledge/import/preview", async (request, response, next) => {
  try {
    const bundle = normalizeKnowledgeImport(request.body);
    if ("error" in bundle) { response.status(400).json({ error: bundle.error }); return; }
    const existingIds = new Set((await readCustomKnowledge()).map((record) => record.id));
    const existingBuiltInIds = new Set(knowledgeRecords.map((record) => record.id));
    if (bundle.records.some((record) => existingBuiltInIds.has(record.id))) {
      response.status(400).json({ error: "导入文件包含内置资料 ID；请先导出自建资料，再导入该备份。" }); return;
    }
    const updateCount = bundle.records.filter((record) => existingIds.has(record.id)).length;
    const existingReviews = await readKnowledgeReviews();
    const reviewIds = Object.keys(bundle.reviews ?? {});
    const updateReviewCount = reviewIds.filter((id) => Boolean(existingReviews[id]?.reviewHistory?.length)).length;
    response.json({ bundle, insertCount: bundle.records.length - updateCount, updateCount, insertReviewCount: reviewIds.length - updateReviewCount, updateReviewCount });
  } catch (error) { next(error); }
});

router.post("/knowledge/import", async (request, response, next) => {
  try {
    const bundle = normalizeKnowledgeImport(request.body);
    if ("error" in bundle) { response.status(400).json({ error: bundle.error }); return; }
    const builtInIds = new Set(knowledgeRecords.map((record) => record.id));
    if (bundle.records.some((record) => builtInIds.has(record.id))) {
      response.status(400).json({ error: "导入文件包含内置资料 ID，已取消写入。" }); return;
    }
    const custom = await readCustomKnowledge();
    const existingIds = new Set(custom.map((record) => record.id));
    const importedIds = new Set(bundle.records.map((record) => record.id));
    const nextCustom = [...bundle.records.map(({ reviewHistory: _reviewHistory, ...record }) => record), ...custom.filter((record) => !importedIds.has(record.id))];
    const reviews = await readKnowledgeReviews();
    const builtInReviewIds = Object.keys(bundle.reviews ?? {});
    const updateReviewCount = builtInReviewIds.filter((id) => Boolean(reviews[id]?.reviewHistory?.length)).length;
    for (const record of bundle.records) {
      const history = record.reviewHistory ?? [];
      const latest = history.at(-1);
      if (latest) {
        reviews[record.id] = {
          significanceScore: latest.significanceScore,
          scoreRationale: latest.scoreRationale,
          verificationStatus: latest.verificationStatus,
          updatedAt: latest.updatedAt.slice(0, 10),
          reviewHistory: history,
        };
      } else {
        delete reviews[record.id];
      }
    }
    for (const [id, history] of Object.entries(bundle.reviews ?? {})) {
      const latest = history.at(-1);
      if (!latest) continue;
      reviews[id] = {
        significanceScore: latest.significanceScore,
        scoreRationale: latest.scoreRationale,
        verificationStatus: latest.verificationStatus,
        updatedAt: latest.updatedAt.slice(0, 10),
        reviewHistory: history,
      };
    }
    await mkdir(path.dirname(customKnowledgePath), { recursive: true });
    await mkdir(path.dirname(knowledgeReviewsPath), { recursive: true });
    await writeFile(customKnowledgePath, JSON.stringify(nextCustom, null, 2), "utf8");
    await writeFile(knowledgeReviewsPath, JSON.stringify(reviews, null, 2), "utf8");
    const mergedReviews = await readKnowledgeReviews();
    const allRecords = await readKnowledgeRecords();
    response.json({
      records: allRecords.map((record) => ({ ...record, ...(mergedReviews[record.id] ?? {}) })),
      insertCount: bundle.records.filter((record) => !existingIds.has(record.id)).length,
      updateCount: bundle.records.filter((record) => existingIds.has(record.id)).length,
      insertReviewCount: builtInReviewIds.length - updateReviewCount,
      updateReviewCount,
    });
  } catch (error) { next(error); }
});

router.post("/knowledge/filter-draft", async (request, response, next) => {
  try {
    const instruction = typeof request.body?.instruction === "string" ? request.body.instruction.trim().slice(0, 500) : "";
    if (!instruction) { response.status(400).json({ error: "请描述希望查找的资料。" }); return; }
    if (!process.env.OPENAI_API_KEY) { response.status(503).json({ error: "尚未配置模型服务，无法生成筛选草案。" }); return; }
    const suggestion = await suggestKnowledgeFilters(instruction);
    response.json({ suggestion });
  } catch (error) { next(error); }
});

router.post("/knowledge", async (request, response, next) => {
  try {
    const input = request.body ?? {};
    const kind = input.kind as KnowledgeRecord["kind"];
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";
    if (!title || !["competition", "journal", "company"].includes(kind)) {
      response.status(400).json({ error: "请填写资料名称并选择有效类别。" }); return;
    }
    const record: KnowledgeRecord = {
      id: `custom-${crypto.randomUUID()}`,
      kind,
      title,
      aliases: Array.isArray(input.aliases) ? input.aliases.filter((item: unknown): item is string => typeof item === "string").map((item: string) => item.trim()).filter(Boolean).slice(0, 8) : [],
      field: textInput(input.field, 120), organizer: textInput(input.organizer, 120), region: textInput(input.region, 80),
      summary: textInput(input.summary, 1200), signals: Array.isArray(input.signals) ? input.signals.filter((item: unknown): item is string => typeof item === "string").slice(0, 10) : [],
      officialUrl: safeHttpUrl(input.officialUrl), significanceScore: 50,
      evidenceSources: normalizeKnowledgeEvidenceSources(input.evidenceSources),
      scoreRationale: "新建资料尚未评估。请核验可靠来源和岗位相关证据。",
      verificationStatus: "示例资料，待核验", updatedAt: new Date().toISOString().slice(0, 10),
    };
    const custom = await readCustomKnowledge();
    custom.unshift(record);
    await mkdir(path.dirname(customKnowledgePath), { recursive: true });
    await writeFile(customKnowledgePath, JSON.stringify(custom, null, 2), "utf8");
    response.status(201).json({ record });
  } catch (error) { next(error); }
});

router.post("/knowledge/enrich", async (request, response, next) => {
  response.status(410).json({ error: "资料联网整理功能已移除，请手动维护资料库。" });
  return;
  /*
  try {
    const input = request.body ?? {};
    const title = textInput(input.title, 160);
    const kind = input.kind as KnowledgeRecord["kind"];
    if (!title || !["competition", "journal", "company"].includes(kind)) {
      response.status(400).json({ error: "请先填写资料名称并选择有效类别。" }); return;
    }
    if (!process.env.OPENAI_API_KEY) {
      response.status(503).json({ error: "尚未配置模型服务，无法整理资料草案。" }); return;
    }
    const field = textInput(input.field, 120);
    const organizer = textInput(input.organizer, 120);
    const region = textInput(input.region, 80);
    const summary = textInput(input.summary, 1200);
    const signals = stringList(input.signals, 10, 100);
    const officialUrl = safeHttpUrl(input.officialUrl);
    const reviewerHints = textInput(input.reviewerHints, 300);
    let sources: Awaited<ReturnType<typeof searchPublicWeb>> = [];
    let searchStatus: "searched" | "no-results" | "not-configured" | "unavailable" = process.env.TAVILY_API_KEY ? "no-results" : "not-configured";
    if (process.env.TAVILY_API_KEY) {
      const category = kind === "competition" ? "竞赛" : kind === "journal" ? "期刊 会议" : "公司 官方";
      try {
        sources = await searchPublicWeb(`${title} ${organizer} ${field} ${category}`, 5);
        searchStatus = sources.length ? "searched" : "no-results";
      } catch {
        searchStatus = "unavailable";
      }
    }
    const suggestion = await enrichKnowledgeDraft({ title, kind, field, organizer, region, summary, signals, officialUrl, reviewerHints, sources });
    response.json({ suggestion, sources, searchStatus });
  } catch (error) { next(error); }
  */
});

router.put("/knowledge/:id", async (request, response, next) => {
  try {
    const records = await readKnowledgeRecords();
    const existing = records.find((item) => item.id === request.params.id);
    if (!existing) { response.status(404).json({ error: "找不到资料记录。" }); return; }
    if (!existing.id.startsWith("custom-")) { response.status(403).json({ error: "内置示例资料只读；可直接保存其人工评估与核验记录。" }); return; }
    const input = request.body ?? {};
    const title = textInput(input.title, 160);
    const kind = input.kind as KnowledgeRecord["kind"];
    if (!title || !["competition", "journal", "company"].includes(kind)) {
      response.status(400).json({ error: "请填写资料名称并选择有效类别。" }); return;
    }
    const updated: KnowledgeRecord = {
      ...existing,
      title,
      kind,
      aliases: stringList(input.aliases, 8, 100),
      field: textInput(input.field, 120),
      organizer: textInput(input.organizer, 120),
      region: textInput(input.region, 80),
      summary: textInput(input.summary, 1200),
      signals: stringList(input.signals, 10, 100),
      officialUrl: safeHttpUrl(input.officialUrl),
      evidenceSources: normalizeKnowledgeEvidenceSources(input.evidenceSources, existing.evidenceSources ?? []),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    const custom = await readCustomKnowledge();
    const next = [updated, ...custom.filter((item) => item.id !== updated.id)];
    await mkdir(path.dirname(customKnowledgePath), { recursive: true });
    await writeFile(customKnowledgePath, JSON.stringify(next, null, 2), "utf8");
    const reviews = await readKnowledgeReviews();
    response.json({ record: { ...updated, ...(reviews[updated.id] ?? {}) } });
  } catch (error) { next(error); }
});

router.delete("/knowledge/:id", async (request, response, next) => {
  try {
    const custom = await readCustomKnowledge();
    const nextRecords = custom.filter((record) => record.id !== request.params.id);
    if (nextRecords.length === custom.length) { response.status(404).json({ error: "只能删除本地新增的资料，或该资料已不存在。" }); return; }
    await mkdir(path.dirname(customKnowledgePath), { recursive: true });
    await catalogStore.remove(request.params.id);
    await writeFile(customKnowledgePath, JSON.stringify(nextRecords, null, 2), "utf8");
    const reviews = await readKnowledgeReviews();
    if (reviews[request.params.id]) {
      delete reviews[request.params.id];
      await mkdir(path.dirname(knowledgeReviewsPath), { recursive: true });
      await writeFile(knowledgeReviewsPath, JSON.stringify(reviews, null, 2), "utf8");
    }
    response.json({ deleted: true });
  } catch (error) { next(error); }
});

router.put("/knowledge/:id/review", async (request, response, next) => {
  try {
    const record = (await readKnowledgeRecords()).find((item) => item.id === request.params.id);
    if (!record) { response.status(404).json({ error: "找不到资料记录。" }); return; }
    const score = Number(request.body?.significanceScore);
    const reviews = await readKnowledgeReviews();
    const previous = reviews[record.id];
    const rationale = typeof request.body?.scoreRationale === "string" ? request.body.scoreRationale.trim().slice(0, 500) : previous?.scoreRationale ?? record.scoreRationale;
    const verificationStatus = request.body?.verificationStatus;
    if (!Number.isFinite(score) || score < 0 || score > 100) { response.status(400).json({ error: "含金量评分需要是 0 到 100 之间的数字。" }); return; }
    if (verificationStatus !== undefined && !["示例资料，待核验", "已核验"].includes(verificationStatus)) { response.status(400).json({ error: "请选择有效的核验状态。" }); return; }
    const status = verificationStatus ?? previous?.verificationStatus ?? record.verificationStatus;
    const reviewedAt = new Date().toISOString();
    const source = request.body?.source === "ai-assisted" ? "ai-assisted" : "manual";
    const previousHistory = Array.isArray(previous?.reviewHistory) ? previous.reviewHistory : [];
    const availableSourceIds = new Set((record.evidenceSources ?? []).map((item) => item.id));
    const evidenceSourceIds: string[] = Array.isArray(request.body?.evidenceSourceIds)
      ? [...new Set<string>(request.body.evidenceSourceIds.filter((id: unknown): id is string => typeof id === "string" && availableSourceIds.has(id)) as string[])].slice(0, 12)
      : [];
    const evidenceSources = (record.evidenceSources ?? [])
      .filter((item) => evidenceSourceIds.includes(item.id))
      .map((item) => ({ ...item }));
    const reviewHistory = [...previousHistory, {
      id: randomUUID(), significanceScore: Math.round(score), scoreRationale: rationale,
      verificationStatus: status, updatedAt: reviewedAt, source, evidenceSourceIds, evidenceSources,
    } satisfies KnowledgeReviewEntry].slice(-30);
    reviews[record.id] = { significanceScore: Math.round(score), scoreRationale: rationale, verificationStatus: status, updatedAt: reviewedAt.slice(0, 10), reviewHistory };
    await mkdir(path.dirname(knowledgeReviewsPath), { recursive: true });
    await writeFile(knowledgeReviewsPath, JSON.stringify(reviews, null, 2), "utf8");
    response.json({ record: { ...record, ...reviews[record.id] } });
  } catch (error) { next(error); }
});

router.post("/knowledge/:id/suggest", async (request, response, next) => {
  response.status(410).json({ error: "竞赛、论文和项目资料的联网核查功能已移除，请使用人工评估。" });
  return;
  /*
  try {
    const record = (await readKnowledgeRecords()).find((item) => item.id === request.params.id);
    if (!record) { response.status(404).json({ error: "找不到资料记录。" }); return; }
    const roleContext = typeof request.body?.roleContext === "string" ? request.body.roleContext.trim().slice(0, 300) : "";
    const reviewerFocus = typeof request.body?.reviewerFocus === "string" ? request.body.reviewerFocus.trim().slice(0, 500) : "";
    const searchConfigured = Boolean(process.env.TAVILY_API_KEY);
    let sources: Awaited<ReturnType<typeof searchPublicWeb>> = [];
    let searchStatus: "searched" | "no-results" | "not-configured" | "unavailable" = searchConfigured ? "no-results" : "not-configured";
    if (searchConfigured) {
      const category = record.kind === "competition" ? "竞赛" : record.kind === "journal" ? "期刊 会议" : "公司 官方";
      try {
        sources = await searchPublicWeb(`${record.title} ${record.organizer} ${record.field} ${category}`, 5);
        searchStatus = sources.length ? "searched" : "no-results";
      } catch {
        searchStatus = "unavailable";
      }
    }
    const suggestion = await suggestKnowledgeAssessment({ ...record, roleContext, reviewerFocus, sources, searchStatus });
    response.json({ suggestion, sources, searchStatus });
  } catch (error) { next(error); }
  */
});

router.get("/scoring/weights", async (_request, response) => {
  response.json({ weights: await readWeights() });
});

router.put("/scoring/weights", async (request, response, next) => {
  try {
    const weights = normalizeWeightInput(request.body?.weights);
    await saveWeights(weights);
    response.json({ weights });
  } catch (error) { next(error); }
});

router.post("/scoring/weights/adjust", async (request, response, next) => {
  try {
    const instruction = request.body?.instruction;
    if (typeof instruction !== "string" || !instruction.trim()) {
      response.status(400).json({ error: "请描述希望如何调整评分权重。" });
      return;
    }
    const currentWeights = request.body?.currentWeights
      ? normalizeWeightInput(request.body.currentWeights)
      : await readWeights();
    const proposal = await suggestScoreWeights(instruction, currentWeights);
    response.json(proposal);
  } catch (error) { next(error); }
});

router.use(async (_request, _response, next) => {
  try {
    await mkdir(directory, { recursive: true });
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/", async (_request, response, next) => {
  try {
    const records = await readDirectory();
    response.json({ directory, resumes: records });
  } catch (error) {
    next(error);
  }
});

router.post("/scan", async (_request, response, next) => {
  try {
    const names = await readdir(directory);
    const records: ResumeRecord[] = [];
    for (const name of names.filter((value) => value.toLowerCase().endsWith(".pdf"))) {
      const filePath = path.join(directory, name);
      const id = path.basename(name, path.extname(name));
      const existing = await readRecord(id);
      if (existing?.extractionVersion === extractionVersion) {
        records.push(existing);
        continue;
      }
      const record = await indexPdf(filePath, id, name);
      await writeRecord(record);
      records.push(record);
    }
    response.json({ directory, resumes: records.sort(sortRecords) });
  } catch (error) {
    next(error);
  }
});

router.post("/open-folder", (_request, response) => {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [directory], { detached: true, stdio: "ignore" });
  child.once("error", () => response.status(500).json({ error: "无法打开简历文件夹。" }));
  child.once("spawn", () => {
    child.unref();
    response.json({ opened: true });
  });
});

router.post("/", async (request, response, next) => {
  try {
    const buffer = request.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      response.status(400).json({ error: "请选择要导入的 PDF 文件。" });
      return;
    }
    if (buffer.length > maxPdfSize) {
      response.status(413).json({ error: "PDF 文件不能超过 30 MB。" });
      return;
    }
    if (buffer.subarray(0, 5).toString() !== "%PDF-") {
      response.status(415).json({ error: "文件内容不是有效的 PDF。" });
      return;
    }

    const suppliedName = decodeURIComponent(String(request.header("x-file-name") || "resume.pdf"));
    const originalName = path.basename(suppliedName).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    const stem = path.basename(originalName, path.extname(originalName)).trim() || "resume";
    const id = `${stem.slice(0, 80)}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const fileName = `${id}.pdf`;
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, buffer, { flag: "wx" });

    try {
      const record = await indexPdf(filePath, id, fileName);
      await writeRecord(record);
      response.status(201).json(record);
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

router.get("/:id/file", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) {
      response.status(404).json({ error: "找不到这份简历。" });
      return;
    }
    response.type("application/pdf");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.fileName)}`);
    response.sendFile(path.join(directory, record.fileName));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) {
      response.status(404).json({ error: "找不到这份简历。" });
      return;
    }
    await Promise.all([
      rm(path.join(directory, record.fileName), { force: true }),
      rm(metadataPath(record.id), { force: true }),
    ]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/:id/agents/run", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) { response.status(404).json({ error: "找不到这份简历。" }); return; }
    const body = request.body ?? {};
    const requested = Array.isArray(body.agents) ? body.agents : [];
    const ocrText = typeof body.ocrText === "string" ? body.ocrText : "";
    if (!requested.length || requested.some((id: unknown) => typeof id !== "string" || !resumeAnalysisAgentIds.includes(id as typeof resumeAnalysisAgentIds[number]))) {
      response.status(400).json({ error: "请提供有效的分析 Agent 功能列表。", available: resumeAnalysisAgentIds }); return;
    }
    if (ocrText.length > 100_000 || typeof body.force !== "undefined" && typeof body.force !== "boolean"
      || typeof body.useModel !== "undefined" && typeof body.useModel !== "boolean"
      ) {
      response.status(400).json({ error: "OCR 文本不得超过 100000 字符，force 和 useModel 必须为布尔值。" }); return;
    }
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error("Agent 运行已取消。"));
    request.once("aborted", cancel);
    response.once("close", cancel);
    try {
      const run = await runResumeAgents({
        context: {
          resumeText: ocrText.trim() ? ocrText : record.text,
          fileName: record.fileName,
          roleRequirements: typeof body.roleRequirements === "string" ? body.roleRequirements.slice(0, 12_000) : "",
          question: typeof body.question === "string" ? body.question.slice(0, 2_000) : "",
          reviewerFocus: typeof body.reviewerFocus === "string" ? body.reviewerFocus.slice(0, 500) : "",
          useModel: body.useModel !== false,
          includeResearch: false,
        },
        requested: requested as typeof resumeAnalysisAgentIds[number][],
        artifacts: record.agentArtifacts,
        force: body.force === true,
        signal: controller.signal,
      });
      const candidate = run.outputs["candidate-profile"];
      const nextRecord: ResumeRecord = { ...record, agentArtifacts: run.artifacts };
      if (run.executed.includes("candidate-profile") && candidate && typeof candidate === "object") {
        const fields = candidate as { name?: unknown; role?: unknown; location?: unknown; education?: unknown; skills?: unknown; summary?: unknown };
        if (typeof fields.name === "string" && fields.name.trim()) nextRecord.name = fields.name.trim();
        if (typeof fields.role === "string" && fields.role.trim()) nextRecord.role = fields.role.trim();
        if (typeof fields.location === "string" && fields.location.trim()) nextRecord.location = fields.location.trim();
        if (typeof fields.education === "string" && fields.education.trim()) nextRecord.education = fields.education.trim();
        if (Array.isArray(fields.skills)) nextRecord.skills = fields.skills.filter((value): value is string => typeof value === "string").slice(0, 10);
        if (typeof fields.summary === "string") nextRecord.summary = fields.summary;
      }
      if (run.executed.includes("analysis-report")) {
        const reportOutput = run.outputs["analysis-report"];
        const reportText = reportOutput && typeof reportOutput === "object" && typeof (reportOutput as { answer?: unknown }).answer === "string"
          ? (reportOutput as { answer: string }).answer
          : typeof reportOutput === "string" ? reportOutput : "";
        if (reportText) nextRecord.analysisReport = reportText;
        nextRecord.analysisStatus = "complete";
        nextRecord.analysisError = "";
        nextRecord.analyzedAt = new Date().toISOString();
      }
      nextRecord.analysisDebug = run.debug;
      if (run.executed.includes("score-calculation")) {
        const assessment = run.outputs["score-calculation"] as Assessment;
        nextRecord.assessment = assessment;
        nextRecord.assessmentHistory = [...(record.assessmentHistory ?? []), { reason: "review", assessment }];
      }
      controller.signal.throwIfAborted();
      await writeRecord(nextRecord, controller.signal);
      response.json({ ...run, resume: nextRecord });
    } finally {
      request.removeListener("aborted", cancel);
      response.removeListener("close", cancel);
    }
  } catch (error) { next(error); }
});

router.post("/:id/assessment", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) { response.status(404).json({ error: "找不到这份简历。" }); return; }
    const { ocrText = "", streamProgress = false } = request.body ?? {};
    if (Object.hasOwn(request.body ?? {}, "includeResearch")) {
      response.status(400).json({ error: "候选人成果真实性核查功能已移除。" });
      return;
    }
    if (typeof streamProgress !== "boolean" || typeof ocrText !== "string" || ocrText.length > 100_000) {
      response.status(400).json({ error: "进度开关必须为布尔值，OCR 文本最多 100000 字符。" }); return;
    }
    await respondWithAnalysis(request, response, async (options) => {
      const result = await evaluateResume(ocrText.trim() ? ocrText : record.text, { ...options, includeResearch: false, useModel: true });
      options.signal.throwIfAborted();
      const updated = await saveAssessment(record.id, result.assessment, assessmentReport(result.assessment), options.signal);
      return { ...result, assessment: updated.assessment ?? result.assessment, resume: updated, answer: assessmentReport(updated.assessment ?? result.assessment) };
    });
  } catch (error) { next(error); }
});

router.post("/:id/analyze", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) {
      response.status(404).json({ error: "找不到这份简历。" });
      return;
    }
    const { roleRequirements, question, streamProgress = false, ocrText = "" } = request.body ?? {};
    if (Object.hasOwn(request.body ?? {}, "includeResearch") || Object.hasOwn(request.body ?? {}, "webResearchEnabled")) {
      response.status(400).json({ error: "候选人成果真实性核查与联网查找功能已移除。" });
      return;
    }
    if (typeof question !== "string" || typeof roleRequirements !== "string") {
      response.status(400).json({ error: "请提供分析任务和职位要求文本。" });
      return;
    }
    if (typeof streamProgress !== "boolean" || typeof ocrText !== "string" || ocrText.length > 100_000) {
      response.status(400).json({ error: "进度开关必须为布尔值，OCR 文本不得超过 100000 字符。" });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      response.status(503).json({ error: "尚未配置模型服务。请在 .env 中填写 OPENAI_API_KEY。" });
      return;
    }
    const resumeText = ocrText.trim() ? ocrText : record.text;
    if (resumeText.length > 100_000) {
      response.status(400).json({ error: "简历文本不得超过 100000 字符。" });
      return;
    }
    await respondWithAnalysis(request, response, async ({ signal, emit }) => {
      const markdown: string[] = [];
      const run = await runResumeAgents({
        context: { resumeText, fileName: record.fileName, roleRequirements, question, includeResearch: false, webResearchEnabled: false },
        requested: [...resumeAnalysisAgentIds],
        artifacts: record.agentArtifacts,
        signal,
        onAgentComplete: ({ id, label, markdown: section, reused, completed, total, output, timing }) => {
          if (section) {
            markdown.push(section);
            emit({ type: "agent", agentId: id, label, markdown: section, reused, completed, total, timing });
          }
          emit({ type: "progress", progress: { stage: id.includes("research") ? "researching" : id === "score-calculation" ? "scoring" : "analyzing", completed, total, message: `${label}已完成${reused ? "（复用已有结果）" : ""}。` } });
        },
      });
      signal.throwIfAborted();
      const report = run.outputs["analysis-report"] as { researchSources?: AnalysisResult["researchSources"]; researchStatus?: AnalysisResult["researchStatus"] } | undefined;
      const answer = markdown.join("\n\n");
      const assessment = run.outputs["score-calculation"] as Assessment;
      const updated = await saveAssessment(record.id, assessment, answer, signal);
      const saved = { ...updated, agentArtifacts: run.artifacts };
      saved.analysisDebug = run.debug;
      await writeRecord(saved, signal);
      return {
        answer,
        research: { items: [], notes: [] },
        assessment: saved.assessment ?? assessment,
        resume: saved,
        researchSources: report?.researchSources,
        researchStatus: report?.researchStatus,
        debug: run.debug,
      };
    });
  } catch (error) {
    next(error);
  }
});

async function readDirectory(): Promise<ResumeRecord[]> {
  const names = await readdir(directory);
  const pdfNames = names.filter((name) => name.toLowerCase().endsWith(".pdf"));
  const records: ResumeRecord[] = [];
  for (let offset = 0; offset < pdfNames.length; offset += 3) {
    const batch = await Promise.all(pdfNames.slice(offset, offset + 3).map(async (name) => {
      const id = path.basename(name, path.extname(name));
      const existing = await readRecord(id);
      // Startup listing must stay responsive. Existing metadata is returned as-is;
      // explicit scan/retry endpoints can rebuild stale records in the background.
      if (existing) return existing;
      const record = await indexPdf(path.join(directory, name), id, name);
      await writeRecord(record);
      return record;
    }));
    records.push(...batch);
  }
  return records.sort(sortRecords);
}

async function indexPdf(filePath: string, id: string, fileName: string): Promise<ResumeRecord> {
  const buffer = await readFile(filePath);
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: `${path.join(pdfjsDirectory, "cmaps")}${path.sep}`,
    cMapPacked: true,
    standardFontDataUrl: `${path.join(pdfjsDirectory, "standard_fonts")}${path.sep}`,
    useSystemFonts: true,
  }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    page.cleanup();
  }
  await pdf.destroy();
  const text = pages.join("\n\n").trim();
  const initialContext = { resumeText: text, fileName, useModel: true, includeResearch: false };
  const initialAgents = text
    ? await runResumeAgents({ context: initialContext, requested: ["candidate-profile"] })
    : null;
  const ai = initialAgents?.outputs["candidate-profile"] as {
    name?: string; role?: string; location?: string; education?: string; skills?: string[]; summary?: string;
  } | null | undefined;
  const fallbackName = path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ").trim();
  const name = ai?.name?.trim() || fallbackName || "未命名候选人";
  const fileStats = await stat(filePath);
  const record: ResumeRecord = {
    id,
    fileName,
    name,
    role: ai?.role?.trim() || "待提取岗位",
    location: ai?.location?.trim() || "未识别地点",
    received: new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(fileStats.mtime),
    initials: name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    source: "pdf",
    text,
    education: ai?.education?.trim() || "待确认",
    skills: Array.isArray(ai?.skills) ? ai.skills.filter((value): value is string => typeof value === "string").slice(0, 10) : [],
    summary: ai?.summary?.trim() || "",
    analysisReport: "",
    analysisStatus: process.env.OPENAI_API_KEY ? "failed" : "unavailable",
    analysisError: process.env.OPENAI_API_KEY ? "" : "未配置模型服务，无法生成初始分析报告。",
    analyzedAt: "",
    pages: pages.length,
    size: fileStats.size,
    extractionVersion,
    agentArtifacts: initialAgents?.artifacts ?? [],
  };

  if (text) {
  try {
      const scoringRun = await runResumeAgents({
        context: initialContext,
        requested: ["score-calculation"],
        artifacts: record.agentArtifacts,
      });
      record.agentArtifacts = scoringRun.artifacts;
      const assessment = scoringRun.outputs["score-calculation"] as Assessment;
      record.assessment = assessment;
      record.assessmentHistory = [{ reason: "import", assessment }];
      let analysisReport = assessmentReport(assessment);
      if (process.env.OPENAI_API_KEY) try {
        const reportRun = await runResumeAgents({
          context: initialContext,
          requested: ["analysis-report"],
          artifacts: record.agentArtifacts,
        });
        record.agentArtifacts = reportRun.artifacts;
        const reportOutput = reportRun.outputs["analysis-report"];
        if (reportOutput && typeof reportOutput === "object" && typeof (reportOutput as { answer?: unknown }).answer === "string") {
          analysisReport = (reportOutput as { answer: string }).answer;
        } else if (typeof reportOutput === "string") {
          analysisReport = reportOutput;
        }
      } catch { record.assessment.notes.push("初始文字报告生成失败，当前展示规则计算报告。"); }
      record.analysisReport = analysisReport;
      record.analysisStatus = "complete";
      record.analysisError = "";
      record.analyzedAt = new Date().toISOString();
    } catch (error) {
      record.analysisStatus = "failed";
      record.analysisError = error instanceof Error ? error.message : "初始分析报告生成失败";
    }
  } else if (!text) {
    record.analysisStatus = "failed";
    record.analysisError = "没有提取到可分析文本。扫描件 PDF 需要先接入 OCR。";
  }
  return record;
}

async function readWeights(): Promise<ScoreWeights> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as { weights?: Partial<ScoreWeights> };
    return normalizeWeightInput(parsed.weights);
  } catch { return defaultScoreWeights; }
}

async function saveWeights(weights: ScoreWeights): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({ weights }, null, 2), "utf8");
}

async function readHistoryCandidates(): Promise<HistoricalCandidate[]> {
  try { return JSON.parse(await readFile(historyCandidatesPath, "utf8")) as HistoricalCandidate[]; }
  catch { return []; }
}

async function writeHistoryCandidates(candidates: HistoricalCandidate[]): Promise<void> {
  await mkdir(path.dirname(historyCandidatesPath), { recursive: true });
  await writeFile(historyCandidatesPath, JSON.stringify(candidates, null, 2), "utf8");
}

function normalizeWeightInput(input: unknown): ScoreWeights {
  const record = input && typeof input === "object" ? input as Partial<ScoreWeights> : {};
  return normalizeWeights(Object.fromEntries(Object.keys(defaultScoreWeights).map((key) => {
    const value = Number(record[key as keyof ScoreWeights]);
    return [key, Number.isFinite(value) ? Math.max(0, value) : defaultScoreWeights[key as keyof ScoreWeights]];
  })) as ScoreWeights);
}

type StoredKnowledgeReview = { significanceScore?: number; scoreRationale?: string; verificationStatus?: KnowledgeRecord["verificationStatus"]; updatedAt?: string; reviewHistory?: KnowledgeReviewEntry[] };

async function readKnowledgeReviews(): Promise<Record<string, StoredKnowledgeReview>> {
  try { return JSON.parse(await readFile(knowledgeReviewsPath, "utf8")) as Record<string, StoredKnowledgeReview>; }
  catch { return {}; }
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
}

function textInput(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function safeHttpUrl(value: unknown): string {
  const candidate = textInput(value, 500);
  try { const url = new URL(candidate); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""; }
  catch { return ""; }
}

async function writeRecord(record: ResumeRecord, signal?: AbortSignal): Promise<void> {
  await mkdir(path.join(directory, ".metadata"), { recursive: true });
  const destination = metadataPath(record.id);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", signal });
    signal?.throwIfAborted();
    await rename(temporary, destination);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

async function saveAssessment(id: string, assessment: Assessment, report: string, signal?: AbortSignal): Promise<ResumeRecord> {
  const previous = assessmentSaves.get(id) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    signal?.throwIfAborted();
    const latest = await readRecord(id);
    if (!latest) throw new Error("候选人档案已删除，未重新创建评分记录。");
    const duplicate = latest.assessmentHistory?.some((entry) => entry.assessment.id === assessment.id);
    const savedAssessment = duplicate ? { ...assessment, id: randomUUID(), evaluatedAt: new Date().toISOString() } : assessment;
    const updated: ResumeRecord = { ...latest, assessment: savedAssessment, assessmentHistory: [...(latest.assessmentHistory ?? []), { reason: "review", assessment: savedAssessment }], analysisReport: report, analysisStatus: "complete", analysisError: "", analyzedAt: savedAssessment.evaluatedAt };
    signal?.throwIfAborted();
    await writeRecord(updated, signal);
    return updated;
  });
  assessmentSaves.set(id, pending);
  // Keep the resolved tail in the per-candidate queue. A second request can
  // finish extracting after the first write and still must observe that write
  // before appending its own history entry.
  return pending;
}

async function readRecord(id: string): Promise<ResumeRecord | null> {
  try {
    return JSON.parse(await readFile(metadataPath(id), "utf8")) as ResumeRecord;
  } catch {
    return null;
  }
}

function metadataPath(id: string): string {
  return path.join(directory, ".metadata", `${path.basename(id)}.json`);
}

function sortRecords(a: ResumeRecord, b: ResumeRecord): number {
  return b.received.localeCompare(a.received, "zh-CN");
}

export default router;
