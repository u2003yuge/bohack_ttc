import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { saveResumeAnalysisReport } from "../server/report-store.js";

const directory = path.resolve(process.env.RESUME_DIR || ".data/resumes");
let archived = 0;
let skipped = 0;
const names = await readdir(path.join(directory, ".metadata"));
for (const name of names.filter((name) => name.endsWith(".json"))) {
  const record = JSON.parse(await readFile(path.join(directory, ".metadata", name), "utf8"));
  if (!record.id || !record.fileName || record.analysisStatus !== "complete" || !record.analysisReport?.trim()) { skipped++; continue; }
  if (await saveResumeAnalysisReport(record)) archived++;
}
console.log(JSON.stringify({ archived, skipped, message: "当前简历的已完成报告归档到 reports；重复执行不新增同一版本，不调用 AI。" }));
