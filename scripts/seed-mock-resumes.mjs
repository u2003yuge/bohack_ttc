import "dotenv/config";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pool = path.join(root, "dev-data/mock-resumes");
const args = process.argv.slice(2);
const keepExisting = args.includes("--keep-existing");
const directories = args.filter((arg) => arg !== "--keep-existing");
if (directories.length > 1 || directories.some((arg) => arg.startsWith("--"))) {
  throw new Error("用法：npm run seed:resumes -- [目标目录] [--keep-existing]");
}
const destination = path.resolve(root, directories[0] || process.env.RESUME_DIR || ".data/resumes");
const manifest = JSON.parse(await readFile(path.join(pool, "manifest.json"), "utf8"));
const digest = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(destination, { recursive: true });
let copied = 0;
let existing = 0;
let preserved = 0;
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
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`目标不是普通文件：${entry.file}`);
    if (digest(await readFile(target)) !== entry.sha256) {
      if (!keepExisting) throw new Error(`目标目录已有不同内容：${entry.file}`);
      preserved++;
      continue;
    }
    existing++;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(source, target, constants.COPYFILE_EXCL);
    copied++;
  }
}
console.log(JSON.stringify({ copied, existing, preserved, available: copied + existing, total: manifest.files.length, missing, invalid, directory: destination }));
