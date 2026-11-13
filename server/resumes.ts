import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractCandidate, generateInitialReport, generateRoleReport, generateScoreCard, suggestKnowledgeAssessment, suggestScoreWeights } from "./analysis.js";
import { defaultScoreWeights, normalizeWeights, type ScoreCard, type ScoreHistoryEntry, type ScoreWeights } from "../shared/scoring.js";
import { historicalCandidates } from "../shared/history.js";
import { knowledgeRecords, type KnowledgeRecord, type KnowledgeReviewEntry } from "../shared/knowledge.js";
import { searchPublicWeb } from "./web-search.js";

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

router.get("/history", (_request, response) => {
  response.json({ candidates: historicalCandidates, source: "local-seed", description: "本地历史招聘基准样本" });
});

router.get("/knowledge", async (_request, response, next) => {
  try {
    const reviews = await readKnowledgeReviews();
    const records = await readKnowledgeRecords();
    response.json({ records: records.map((record) => ({ ...record, ...(reviews[record.id] ?? {}) })), source: "local-json" });
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

router.put("/knowledge/:id", async (request, response, next) => {
  try {
    const records = await readKnowledgeRecords();
    const existing = records.find((item) => item.id === request.params.id);
    if (!existing) { response.status(404).json({ error: "找不到资料记录。" }); return; }
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
    const reviewHistory = [...previousHistory, {
      id: randomUUID(), significanceScore: Math.round(score), scoreRationale: rationale,
      verificationStatus: status, updatedAt: reviewedAt, source,
    } satisfies KnowledgeReviewEntry].slice(-30);
    reviews[record.id] = { significanceScore: Math.round(score), scoreRationale: rationale, verificationStatus: status, updatedAt: reviewedAt.slice(0, 10), reviewHistory };
    await mkdir(path.dirname(knowledgeReviewsPath), { recursive: true });
    await writeFile(knowledgeReviewsPath, JSON.stringify(reviews, null, 2), "utf8");
    response.json({ record: { ...record, ...reviews[record.id] } });
  } catch (error) { next(error); }
});

router.post("/knowledge/:id/suggest", async (request, response, next) => {
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

router.post("/:id/analyze", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) {
      response.status(404).json({ error: "找不到这份简历。" });
      return;
    }
    const { roleRequirements, question, webResearchEnabled } = request.body ?? {};
    if (typeof question !== "string" || typeof roleRequirements !== "string") {
      response.status(400).json({ error: "请提供分析任务和职位要求文本。" });
      return;
    }
    const shouldResearch = webResearchEnabled === true && Boolean(roleRequirements.trim());
    let researchSources: Awaited<ReturnType<typeof searchPublicWeb>> = [];
    let researchStatus: "searched" | "not-configured" | "unavailable" | "not-requested" = "not-requested";
    if (shouldResearch) {
      if (!process.env.TAVILY_API_KEY) {
        researchStatus = "not-configured";
      } else {
        try {
          researchSources = await searchPublicWeb(`${roleRequirements.slice(0, 320)} 岗位技能 行业背景 官方`, 4);
          researchStatus = "searched";
        } catch {
          researchStatus = "unavailable";
        }
      }
    }
    const analysisReport = await generateRoleReport({
      name: record.name,
      resumeText: record.text,
      roleRequirements,
      question,
      externalSources: researchSources,
      externalSearchStatus: researchStatus,
    });
    const scoreCard = await generateScoreCard({ name: record.name, resumeText: record.text, roleRequirements, weights: await readWeights() });
    const updated = {
      ...record,
      analysisReport,
      scoreCard,
      scoreHistory: appendScoreHistory(record, scoreCard, "review", roleRequirements),
      analysisStatus: "complete" as const,
      analysisError: "",
      analyzedAt: new Date().toISOString(),
    };
    await writeRecord(updated);
    response.json({ answer: analysisReport, resume: updated, researchSources, researchStatus });
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
  const ai = await extractCandidate(text, fileName);
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
  };

  if (process.env.OPENAI_API_KEY && text) {
  try {
      record.scoreCard = await generateScoreCard({ name: record.name, resumeText: record.text, roleRequirements: "", weights: await readWeights() });
      record.scoreHistory = appendScoreHistory(record, record.scoreCard, "import");
      record.analysisReport = await generateInitialReport({
        name: record.name,
        role: record.role,
        location: record.location,
        education: record.education,
        skills: record.skills,
        resumeText: record.text,
      });
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

function appendScoreHistory(record: ResumeRecord, scoreCard: ScoreCard, reason: ScoreHistoryEntry["reason"], roleRequirements = ""): ScoreHistoryEntry[] {
  const history = record.scoreHistory?.length
    ? record.scoreHistory
    : record.scoreCard
      ? [{ id: `legacy-${record.scoreCard.evaluatedAt}`, evaluatedAt: record.scoreCard.evaluatedAt, reason: "import" as const, scoreCard: record.scoreCard }]
      : [];
  return [...history, { id: crypto.randomUUID(), evaluatedAt: scoreCard.evaluatedAt, reason, roleRequirements: roleRequirements.slice(0, 2000), scoreCard }];
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

async function readCustomKnowledge(): Promise<KnowledgeRecord[]> {
  try { return JSON.parse(await readFile(customKnowledgePath, "utf8")) as KnowledgeRecord[]; }
  catch { return []; }
}

async function readKnowledgeRecords(): Promise<KnowledgeRecord[]> {
  const custom = await readCustomKnowledge();
  const customIds = new Set(custom.map((record) => record.id));
  return [...custom, ...knowledgeRecords.filter((record) => !customIds.has(record.id))];
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

async function writeRecord(record: ResumeRecord): Promise<void> {
  await mkdir(path.join(directory, ".metadata"), { recursive: true });
  await writeFile(metadataPath(record.id), JSON.stringify(record, null, 2), "utf8");
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
