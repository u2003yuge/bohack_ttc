import "dotenv/config";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pool = path.join(root, "dev-data/mock-resumes");
if (process.argv.length > 3) throw new Error("用法：npm run seed:resumes -- [运行时简历目录]");
const directory = path.resolve(root, process.argv[2] || process.env.RESUME_DIR || ".data/resumes");
const relative = path.relative(pool, directory);
if (!relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) {
  throw new Error("运行时简历目录不能放在固定 mock 简历池内。");
}
const manifest = JSON.parse(await readFile(path.join(pool, "manifest.json"), "utf8"));
if (manifest.format !== "bohack-mock-resume-pool" || manifest.version !== 1
  || !Array.isArray(manifest.files) || !manifest.files.length || manifest.count !== manifest.files.length) {
  throw new Error("Mock 简历池清单格式无效，未复制文件。");
}
const digest = (data) => createHash("sha256").update(data).digest("hex");
const identities = new Set();
const files = [];
for (const entry of manifest.files) {
  if (typeof entry.file !== "string" || /[/\\\0]/.test(entry.file) || entry.file.startsWith(".")
    || !entry.file.toLowerCase().endsWith(".pdf") || path.basename(entry.file) !== entry.file
    || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error("Mock 简历池清单包含无效文件，未复制文件。");
  }
  const identity = entry.file.toLowerCase();
  if (identities.has(identity)) throw new Error(`Mock 简历池文件名重复：${entry.file}`);
  identities.add(identity);
  const source = path.join(pool, entry.file);
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Mock 简历池不是普通文件：${entry.file}`);
  const content = await readFile(source);
  if (content.length !== entry.size || digest(content) !== entry.sha256 || !content.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw new Error(`Mock 简历池校验失败：${entry.file}，未复制文件。`);
  }
  const destination = path.join(directory, entry.file);
  let exists = false;
  try {
    const targetStat = await lstat(destination);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || digest(await readFile(destination)) !== entry.sha256) {
      throw new Error(`目标目录已有不同内容：${entry.file}，未覆盖文件。`);
    }
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  files.push({ ...entry, source, destination, exists });
}

// Validate the entire pool and all destination collisions before copying anything.
await mkdir(directory, { recursive: true });
let copied = 0, existing = 0;
for (const file of files) {
  if (file.exists) {
    existing++;
  } else {
    try {
      await copyFile(file.source, file.destination, constants.COPYFILE_EXCL);
      copied++;
    } catch (error) {
      // A second developer process may have seeded the same file after preflight.
      if (error.code !== "EEXIST") throw error;
      existing++;
    }
  }
  if (digest(await readFile(file.destination)) !== file.sha256) {
    throw new Error(`复制后校验失败：${file.file}，请检查目标目录。`);
  }
}
console.log(JSON.stringify({ files: files.length, copied, existing, directory, source: pool }, null, 2));
