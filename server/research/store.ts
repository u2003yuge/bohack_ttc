import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchItem, ResearchReport } from "../../src/research-types.js";

export const databaseDirectory = fileURLToPath(new URL("../../db/", import.meta.url));
const normalize = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function cacheKey(item: ResearchItem): string {
  const input = { ...item.input };
  delete input.age_at_award;
  // Include every supplied disambiguator; fuzzy names never count as a cache hit.
  const identity = [item.kind, Object.keys(input).sort().map((key) => [key, normalize(input[key])]),
    Object.keys(item.context).sort().map((key) => [key, normalize(item.context[key])])];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

type CacheEntry = { version: 1; createdAt: string; report: string; ttlDays: number };

export class ResearchStore {
  constructor(readonly directory = databaseDirectory, readonly ttlDays = 30) {}

  async get(item: ResearchItem): Promise<ResearchReport | null> {
    const directory = path.join(this.directory, item.kind, cacheKey(item));
    let metadata: CacheEntry;
    try {
      metadata = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8")) as CacheEntry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("研究数据库索引损坏，请检查 db 后重试。", { cause: error });
    }
    if (!metadata || metadata.version !== 1 || !Number.isFinite(Date.parse(metadata.createdAt))
      || !Number.isFinite(metadata.ttlDays) || metadata.ttlDays <= 0
      || typeof metadata.report !== "string" || !/^report-[\w-]+\.json$/.test(metadata.report)) {
      throw new Error("研究数据库索引格式无效，请检查 db 后重试。");
    }
    if (Date.now() - Date.parse(metadata.createdAt) > Math.min(this.ttlDays, metadata.ttlDays) * 86_400_000) return null;
    return JSON.parse(await readFile(path.join(directory, metadata.report), "utf8")) as ResearchReport;
  }

  async put(item: ResearchItem, report: ResearchReport, reusable: boolean): Promise<void> {
    const directory = path.join(this.directory, item.kind, cacheKey(item));
    await mkdir(directory, { recursive: true });
    const suffix = `${Date.now()}-${randomUUID()}`;
    const reportName = `report-${suffix}.json`;
    await writeFile(path.join(directory, reportName), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (!reusable) return;
    const metadata: CacheEntry = { version: 1, createdAt: new Date().toISOString(), report: reportName, ttlDays: this.ttlDays };
    const temporary = path.join(directory, `latest-${suffix}.tmp`);
    await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path.join(directory, "latest.json"));
  }
}
