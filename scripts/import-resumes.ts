import "dotenv/config";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { indexPdf, readRecord, writeRecord } from "../server/resumes.js";
import { reportDirectory } from "../server/report-store.js";

const [source, first = "1", last = "160"] = process.argv.slice(2);
const start = Number(first), end = Number(last);
if (!source || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
  throw new Error("用法：npm run import:resumes -- <来源目录> [起始编号=1] [结束编号=160]");
}
const destination = path.resolve(process.env.RESUME_DIR || ".data/resumes");
const digest = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
const files = [];
for (let index = start; index <= end; index++) {
  const name = index + ".pdf";
  const from = path.resolve(source, name), to = path.join(destination, name);
  const content = await readFile(from);
  if (!content.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error(name + " 不是有效的 PDF 文件。");
  const hash = createHash("sha256").update(content).digest("hex");
  let exists = false;
  try {
    await stat(to); exists = true;
    if (await digest(to) !== hash) throw new Error(name + " 在目标位置已存在不同内容，已停止，未覆盖。");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  files.push({ name, from, to, hash, exists });
}
await mkdir(destination, { recursive: true });
await mkdir(reportDirectory(), { recursive: true });
let copied = 0, indexed = 0, emptyText = 0;
const errors: string[] = [];
for (const file of files) {
  try {
    if (!file.exists) { await copyFile(file.from, file.to, constants.COPYFILE_EXCL); copied++; }
    if (await digest(file.to) !== file.hash) throw new Error("复制后哈希不一致。");
    const id = path.basename(file.name, ".pdf");
    const existing = await readRecord(id);
    if (!existing) {
      const record = await indexPdf(file.to, id, file.name, { analyze: false });
      await writeRecord(record);
      indexed++;
      if (!record.text) emptyText++;
    }
  } catch (error) { errors.push(file.name + ": " + (error instanceof Error ? error.message : String(error))); }
  if ((files.indexOf(file) + 1) % 20 === 0) console.log("已处理 " + (files.indexOf(file) + 1) + " / " + files.length);
}
console.log(JSON.stringify({ requested: files.length, copied, indexed, emptyText, verified: files.length - errors.length,
  directory: destination, reports: reportDirectory(), errors }, null, 2));
if (errors.length) process.exitCode = 1;
