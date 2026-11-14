import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeVenueProfile } from "../shared/venue-profile.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = await readFile(path.join(root, "papers.md"), "utf8");
const blocks = [...input.matchAll(/```json\s*([\s\S]*?)```/g)];
if (blocks.length !== 1) throw new Error("papers.md 应包含一个 JSON 数组代码块。");
const records: unknown = JSON.parse(blocks[0][1]);
if (!Array.isArray(records) || !records.length) throw new Error("期刊会议资料不能为空。");
const ids = new Set<string>();
const names = new Set<string>();
for (const [index, raw] of records.entries()) {
  const record = normalizeVenueProfile(raw);
  if (!record) throw new Error(`第 ${index + 1} 条期刊会议字段不完整或网址无效，未写入数据库。`);
  const name = record.name.normalize("NFKC").trim().toLocaleLowerCase();
  if (ids.has(record.id) || names.has(name)) throw new Error(`期刊会议 ID 或名称重复：${record.id}`);
  ids.add(record.id); names.add(name);
}
await mkdir(path.join(root, "db"), { recursive: true });
await writeFile(path.join(root, "db/papers.json"), `${JSON.stringify({
  format: "bohack-venue-catalog", version: 1, sourceFile: "papers.md",
  sourceSha256: createHash("sha256").update(input).digest("hex"), records,
}, null, 2)}\n`, "utf8");
console.log(`已导入 ${records.length} 条期刊会议资料到 db/papers.json，保留全部原始字段。`);
