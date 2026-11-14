import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
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
};

export function reportDirectory(): string {
  return path.resolve(process.env.REPORT_DIR || path.join(path.resolve(process.env.RESUME_DIR || ".data/resumes"), "..", "reports"));
}

export async function saveAnalysisReport(input: ReportContext & {
  resumeId?: string; resumeName: string; fileName?: string; resumeText: string; answer: string;
}, options: { directory?: string; signal?: AbortSignal } = {}) {
  if (!input.answer.trim()) throw new Error("空分析报告不能保存。");
  options.signal?.throwIfAborted();
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const resumeKey = input.resumeId && /^[a-zA-Z0-9_-]{1,120}$/.test(input.resumeId)
    ? input.resumeId : "resume-" + hash(input.resumeId || input.resumeText).slice(0, 32);
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, "-") + "-" + randomUUID();
  const directory = path.join(options.directory ?? reportDirectory(), resumeKey);
  const { resumeText, ...content } = input;
  const report = { format: "bohack-analysis-report", version: 1, id, createdAt,
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini", resumeSha256: hash(resumeText), ...content };
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, id + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    options.signal?.throwIfAborted();
    await rename(temporary, path.join(directory, id + ".json"));
  } finally { await rm(temporary, { force: true }); }
  return report;
}
