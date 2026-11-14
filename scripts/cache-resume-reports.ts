import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { saveTrackedResumeReport } from "../server/tracked-resume-cache.js";

const directory = path.resolve(process.env.RESUME_DIR || ".data/resumes");
let saved = 0;
let skipped = 0;
const names = await readdir(path.join(directory, ".metadata"));
for (const name of names.filter((name) => name.endsWith(".json"))) {
  const record = JSON.parse(await readFile(path.join(directory, ".metadata", name), "utf8"));
  if (!record.id || !record.fileName || record.analysisStatus !== "complete") { skipped++; continue; }
  if (await saveTrackedResumeReport(record, path.join(directory, record.fileName))) saved++;
  else skipped++;
}
console.log(JSON.stringify({ saved, skipped, message: "仅导出与 Git 样本清单内容匹配的已完成报告，不调用 AI。" }));
