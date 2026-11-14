import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type CacheableResume = {
  id: string;
  fileName: string;
  analysisReport: string;
  analysisStatus: "complete" | "unavailable" | "failed";
  analysisError: string;
  analyzedAt: string;
  assessment?: unknown;
  assessmentHistory?: unknown[];
  agentArtifacts?: unknown[];
  analysisDebug?: unknown;
};

type TrackedReportCache = Omit<CacheableResume, "fileName"> & {
  format: "bohack-tracked-resume-report";
  version: 1;
  resumeSha256: string;
};

function sourceDirectory(): string {
  return path.resolve(process.env.TRACKED_RESUME_DIR || path.join(projectRoot, "dev-data/mock-resumes"));
}

function cacheDirectory(): string {
  return path.resolve(process.env.TRACKED_RESUME_CACHE_DIR || path.join(projectRoot, "dev-data/mock-analysis-cache"));
}

async function trackedDigest(id: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) return null;
  try {
    const manifest = JSON.parse(await readFile(path.join(sourceDirectory(), "manifest.json"), "utf8")) as {
      files?: Array<{ file?: unknown; sha256?: unknown }>;
    };
    const entry = manifest.files?.find((file) => file.file === `${id}.pdf`);
    return typeof entry?.sha256 === "string" && /^[a-f0-9]{64}$/i.test(entry.sha256) ? entry.sha256.toLowerCase() : null;
  } catch { return null; }
}

async function digestFile(filePath: string): Promise<string | null> {
  try { return createHash("sha256").update(await readFile(filePath)).digest("hex"); }
  catch { return null; }
}

export async function loadTrackedResumeReport<T extends CacheableResume>(record: T, pdfPath: string): Promise<T> {
  const expectedDigest = await trackedDigest(record.id);
  if (!expectedDigest || await digestFile(pdfPath) !== expectedDigest) return record;
  try {
    const cached = JSON.parse(await readFile(path.join(cacheDirectory(), `${record.id}.json`), "utf8")) as Partial<TrackedReportCache>;
    if (cached.format !== "bohack-tracked-resume-report" || cached.version !== 1 || cached.resumeSha256 !== expectedDigest
      || typeof cached.analysisReport !== "string" || !cached.analysisReport.trim()
      || typeof cached.analyzedAt !== "string" || !Number.isFinite(Date.parse(cached.analyzedAt))) return record;
    const currentTime = Date.parse(record.analyzedAt || "") || 0;
    const cachedTime = Date.parse(cached.analyzedAt) || 0;
    if (record.analysisReport?.trim() && currentTime >= cachedTime) return record;
    return {
      ...record,
      analysisReport: cached.analysisReport,
      analysisStatus: "complete",
      analysisError: "",
      analyzedAt: cached.analyzedAt,
      ...(cached.assessment !== undefined ? { assessment: cached.assessment } : {}),
      ...(Array.isArray(cached.assessmentHistory) ? { assessmentHistory: cached.assessmentHistory } : {}),
      ...(Array.isArray(cached.agentArtifacts) ? { agentArtifacts: cached.agentArtifacts } : {}),
      ...(cached.analysisDebug !== undefined ? { analysisDebug: cached.analysisDebug } : {}),
    };
  } catch { return record; }
}

export async function saveTrackedResumeReport(record: CacheableResume, pdfPath: string): Promise<boolean> {
  const expectedDigest = await trackedDigest(record.id);
  if (!expectedDigest || await digestFile(pdfPath) !== expectedDigest || !record.analysisReport?.trim()
    || record.analysisStatus !== "complete" || !Number.isFinite(Date.parse(record.analyzedAt || ""))) return false;
  const destination = path.join(cacheDirectory(), `${record.id}.json`);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const { id, analysisReport, analysisStatus, analysisError, analyzedAt, assessment, assessmentHistory, agentArtifacts, analysisDebug } = record;
  const cache: TrackedReportCache = {
    format: "bohack-tracked-resume-report", version: 1, resumeSha256: expectedDigest,
    id, analysisReport, analysisStatus, analysisError, analyzedAt,
    ...(assessment !== undefined ? { assessment } : {}),
    ...(assessmentHistory ? { assessmentHistory } : {}),
    ...(agentArtifacts ? { agentArtifacts } : {}),
    ...(analysisDebug !== undefined ? { analysisDebug } : {}),
  };
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(cache, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
    return true;
  } finally { await rm(temporary, { force: true }); }
}
