import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResearchBatch } from "../src/research-types.js";
import type { ScoreCard } from "../shared/scoring.js";

export type ReportContext = {
  kind: "initial" | "role" | "agent";
  question?: string;
  roleRequirements?: string;
  research?: ResearchBatch;
  scoreCard?: ScoreCard;
  researchSources?: unknown[];
  researchStatus?: string;
  assessment?: unknown;
  analyzedAt?: string;
};

export function reportDirectory(): string {
  return path.resolve(process.env.REPORT_DIR || path.join(path.resolve(process.env.RESUME_DIR || ".data/resumes"), "..", "reports"));
}

export async function saveAnalysisReport(input: ReportContext & {
  resumeId?: string; resumeName: string; fileName?: string; resumeText: string; answer: string;
}, options: { directory?: string; signal?: AbortSignal; snapshotKey?: string } = {}) {
  if (!input.answer.trim()) throw new Error("空分析报告不能保存。");
  options.signal?.throwIfAborted();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const resumeKey = input.resumeId && /^[a-zA-Z0-9_-]{1,120}$/.test(input.resumeId)
    ? input.resumeId : "resume-" + hash(input.resumeId || input.resumeText).slice(0, 32);
  const createdAt = new Date().toISOString();
  const id = options.snapshotKey ? "snapshot-" + hash(options.snapshotKey)
    : createdAt.replace(/[:.]/g, "-") + "-" + randomUUID();
  const directory = path.join(options.directory ?? reportDirectory(), resumeKey);
  const destination = path.join(directory, id + ".json");
  if (options.snapshotKey) {
    try { return JSON.parse(await readFile(destination, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const { resumeText, ...content } = input;
  const report = { format: "bohack-analysis-report", version: 1, id, createdAt,
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini", resumeSha256: hash(resumeText), ...content };
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, id + "." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    options.signal?.throwIfAborted();
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
  return report;
}

// Metadata is also written for review changes and Agent cache updates. Archive
// each completed analysis version once, without duplicating it on those writes.
export async function saveResumeAnalysisReport(record: {
  id: string; name?: string; fileName: string; text?: string;
  analysisReport: string; analysisStatus: string; analyzedAt?: string;
  assessment?: unknown; scoreCard?: ScoreCard;
}, options: { directory?: string; signal?: AbortSignal } = {}) {
  if (record.analysisStatus !== "complete" || !record.analysisReport?.trim()) return null;
  return saveAnalysisReport({
    kind: "initial", resumeId: record.id, resumeName: record.name || record.fileName,
    fileName: record.fileName, resumeText: record.text || "", answer: record.analysisReport,
    analyzedAt: record.analyzedAt, assessment: record.assessment, scoreCard: record.scoreCard,
  }, { ...options, snapshotKey: JSON.stringify([record.id, record.analysisReport, record.analyzedAt, record.assessment, record.scoreCard]) });
}
