import "dotenv/config";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { indexPdf, writeHistoryCandidates } from "../server/resumes.js";
import type { HistoricalCandidate } from "../shared/history.js";

const [outcomesFile] = process.argv.slice(2);
if (!outcomesFile) throw new Error("用法：npm run import:history -- <通过情况.txt>");

const outcomes = new Map<number, number>();
let sectionYear = 0;
for (const line of (await readFile(outcomesFile, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
  const heading = /^(24|25)年[：:]$/.exec(line);
  if (heading) { sectionYear = 2000 + Number(heading[1]); continue; }
  const match = /^(\d+)\s+([012])$/.exec(line);
  if (!match) throw new Error(`无法识别的通过情况：${line}`);
  const number = Number(match[1]);
  if (number < 161 || number > 260 || outcomes.has(number)) throw new Error(`编号越界或重复：${number}`);
  if (sectionYear !== (number <= 210 ? 2024 : 2025)) throw new Error(`编号与年份不一致：${number}`);
  outcomes.set(number, Number(match[2]));
}
if (outcomes.size !== 100) throw new Error(`通过情况应包含 100 条，实际为 ${outcomes.size} 条。`);

const metadataPath = path.resolve(process.env.RESUME_DIR || ".data/resumes", ".metadata/history-candidates.json");
let existing: HistoricalCandidate[] = [];
let existingFile = false;
try {
  existing = JSON.parse(await readFile(metadataPath, "utf8"));
  if (!Array.isArray(existing)) throw new Error("现有历史样本数据格式错误，已停止导入。");
  existingFile = true;
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

// Finish parsing every PDF before changing the stored list. No model calls or scores are generated.
const imported: HistoricalCandidate[] = [];
for (let number = 161; number <= 260; number++) {
  const fileName = `${number}.pdf`;
  const record = await indexPdf(path.resolve(".pre_data/resumes", fileName), String(number), fileName, { analyze: false });
  const header = /^(.+?)\s{2,}(.+?)\s{2,}\d+\s*岁/.exec(record.text);
  if (!header) throw new Error(`${fileName} 无法识别姓名和岗位，尚未写入任何历史条目。`);
  const id = `hist-pdf-${number}`;
  const previous = existing.filter((candidate) => candidate.id === id || candidate.fileName === fileName);
  if (previous.length > 1) throw new Error(`${fileName} 存在多个历史条目，已停止导入。`);
  const outcome = outcomes.get(number)!;
  imported.push({
    id: previous[0]?.id ?? id,
    fileName,
    name: header[1].replace(/\s+/g, ""),
    role: header[2].trim(),
    year: number <= 210 ? 2024 : 2025,
    screened: outcome >= 1,
    hired: outcome === 2,
    composite: previous[0]?.composite ?? null,
  });
  if (imported.length % 25 === 0) console.log(`已读取 ${imported.length} / 100 份历史简历`);
}

const importedIds = new Set(imported.map((candidate) => candidate.id));
const importedFiles = new Set(imported.map((candidate) => candidate.fileName));
const retained = existing.filter((candidate) => !importedIds.has(candidate.id) && !importedFiles.has(candidate.fileName));
if (existingFile) await copyFile(metadataPath, `${metadataPath}.${Date.now()}.bak`);
await writeHistoryCandidates([...retained, ...imported]);
console.log(JSON.stringify({
  imported: imported.length,
  retained: retained.length,
  years: [2024, 2025].map((year) => {
    const records = imported.filter((candidate) => candidate.year === year);
    return { year, total: records.length, rejected: records.filter((candidate) => !candidate.screened).length, screened: records.filter((candidate) => candidate.screened && !candidate.hired).length, hired: records.filter((candidate) => candidate.hired).length };
  }),
  metadataPath,
}, null, 2));
