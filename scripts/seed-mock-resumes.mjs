import "dotenv/config";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pool = path.join(root, "dev-data/mock-resumes");
const destination = path.resolve(root, process.argv[2] || process.env.RESUME_DIR || ".data/resumes");
const manifest = JSON.parse(await readFile(path.join(pool, "manifest.json"), "utf8"));
const digest = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(destination, { recursive: true });
let copied = 0;
let existing = 0;
let missing = 0;
const invalid = [];
for (const entry of manifest.files) {
  const source = path.join(pool, entry.file);
  let content;
  try { content = await readFile(source); } catch (error) {
    if (error.code === "ENOENT") { missing++; continue; }
    throw error;
  }
  if (content.length !== entry.size || digest(content) !== entry.sha256) {
    invalid.push(entry.file);
    continue;
  }
  const target = path.join(destination, entry.file);
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || digest(await readFile(target)) !== entry.sha256) throw new Error(`目标目录已有不同内容：${entry.file}`);
    existing++;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(source, target, constants.COPYFILE_EXCL);
    copied++;
  }
}
console.log(JSON.stringify({ copied, existing, available: copied + existing, total: manifest.files.length, missing, invalid, directory: destination }));
