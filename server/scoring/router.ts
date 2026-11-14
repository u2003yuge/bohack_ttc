import { Router } from "express";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  abilityDimensions,
  actionLevels,
  calibrationStatus,
  decayRatio,
  factorDefinitions,
  jobPresets,
  normalizeJobPreference,
  scoringVersion,
  typeAdaptation,
  type JobPreference,
} from "../../shared/material-scoring.js";
import { respondWithAnalysis } from "../analysis-response.js";
import { assessmentReport, evaluateResume } from "./pipeline.js";
import { suggestJobPreference } from "./preferences.js";
import { deadline, errorMessage, limit } from "../operations.js";

const router = Router();
const jobPath = path.resolve(
  process.env.RESUME_DIR || ".data/resumes",
  ".metadata",
  "v1-job-preferences.json",
);
router.get("/rules", (_request, response) =>
  response.json({
    version: scoringVersion,
    calibrationStatus,
    abilities: abilityDimensions,
    factorDefinitions,
    typeAdaptation,
    actionLevels,
    rho: decayRatio,
    jobPresets,
  }),
);
async function readJobs(): Promise<JobPreference[]> {
  try {
    const rows: unknown = JSON.parse(await readFile(jobPath, "utf8"));
    if (!Array.isArray(rows)) throw new Error("岗位配置格式无效。");
    return rows.map(normalizeJobPreference);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
router.get("/jobs", async (_request, response, next) => {
  try {
    response.json({ jobs: await readJobs() });
  } catch (error) {
    next(error);
  }
});
router.put("/jobs", async (request, response) => {
  try {
    const preference = normalizeJobPreference(request.body);
    if (!preference.title) throw new Error("请填写岗位名称。");
    const jobs = await readJobs();
    const next = [...jobs.filter((j) => j.title !== preference.title), preference];
    await mkdir(path.dirname(jobPath), { recursive: true });
    const temporary = `${jobPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
    await rename(temporary, jobPath);
    response.json({ jobs: next, preference });
  } catch (error) {
    response.status(400).json({ error: errorMessage(error) });
  }
});
router.post("/preferences/draft", async (request, response) => {
  const scope = deadline(undefined, limit("MODEL_REQUEST_TIMEOUT_MS", 60_000), "岗位偏好整理超时。");
  const cancel = () => {
    if (!response.writableEnded) scope.abort(new Error("请求已取消。"));
  };
  response.once("close", cancel);
  try {
    if (typeof request.body?.instruction !== "string") throw new Error("请提供岗位偏好文本。");
    const current = normalizeJobPreference(request.body.current);
    response.json(await suggestJobPreference(request.body.instruction, current, scope.signal));
  } catch (error) {
    if (!response.destroyed) response.status(400).json({ error: errorMessage(error) });
  } finally {
    scope.dispose();
    response.removeListener("close", cancel);
  }
});
router.post("/evaluate", async (request, response) => {
  const { text, includeResearch = true, useModel = true, streamProgress = false } = request.body ?? {};
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 100_000 ||
    typeof includeResearch !== "boolean" ||
    typeof useModel !== "boolean" ||
    typeof streamProgress !== "boolean"
  ) {
    response.status(400).json({ error: "请提供 1 到 100000 字符文本及布尔开关。" });
    return;
  }
  await respondWithAnalysis(request, response, async (options) => {
    const result = await evaluateResume(text, { ...options, includeResearch, useModel });
    return { ...result, answer: assessmentReport(result.assessment) };
  });
});
export default router;
