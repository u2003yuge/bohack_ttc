import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = await readFile(path.join(root, "competitions.md"), "utf8");
const blocks = [...input.matchAll(/```json\s*([\s\S]*?)```/g)];
if (blocks.length !== 1) throw new Error("competitions.md 应包含一个 JSON 数组代码块。");
const records = JSON.parse(blocks[0][1]);
if (!Array.isArray(records) || !records.length) throw new Error("赛事资料不能为空。");
const ids = new Set();
const names = new Set();
const strings = ["id", "name", "category", "organizer", "short_info", "info", "influence", "difficulty", "notes"];
const validUrl = (value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
};
for (const record of records) {
  if (strings.some((key) => typeof record[key] !== "string" || !record[key].trim())
    || !Number.isInteger(record.report_year) || record.report_year < 1900 || record.report_year > 2200
    || (record.official_website !== null && !validUrl(record.official_website))
    || ["acquires", "projection"].some((key) => !Array.isArray(record[key]) || !record[key].length || record[key].some((value) => typeof value !== "string" || !value.trim()))
    || !Array.isArray(record.sources) || !record.sources.length || record.sources.some((source) => typeof source.title !== "string" || !source.title.trim() || !validUrl(source.url))) {
    throw new Error(`赛事 ${record.id ?? "未知"} 的字段不完整或网址无效，未写入数据库。`);
  }
  if (ids.has(record.id) || names.has(record.name)) throw new Error(`赛事 ID 或名称重复：${record.id}`);
  ids.add(record.id); names.add(record.name);
}
const database = {
  format: "bohack-competition-catalog", version: 1,
  sourceFile: "competitions.md", sourceSha256: createHash("sha256").update(input).digest("hex"),
  records,
};
await mkdir(path.join(root, "db"), { recursive: true });
await writeFile(path.join(root, "db/competitions.json"), `${JSON.stringify(database, null, 2)}\n`, "utf8");
console.log(`已导入 ${records.length} 条竞赛资料到 db/competitions.json，保留全部原始字段。`);
