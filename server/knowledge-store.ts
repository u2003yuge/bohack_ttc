import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knowledgeRecords, normalizeKnowledgeImport, type KnowledgeRecord } from "../shared/knowledge.js";
import type { CatalogCandidate } from "../src/research-types.js";

const defaultDirectory = fileURLToPath(new URL("../db/library/", import.meta.url));
export const identityName = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s“”「」『』"'《》]/g, "");
const genericNames = new Set(["ai", "cl", "pr", "nn", "mm", "sc", "nature", "science", "自然", "科学", "计算机科学", "computerscience"]);
export function findCatalogRecord(candidate: Pick<CatalogCandidate, "kind" | "name">, records: KnowledgeRecord[]): KnowledgeRecord | undefined {
  const name = identityName(candidate.name);
  const matches = [...new Map(records.filter((record) => record.kind === candidate.kind
    && [record.title, ...record.aliases].some((term) => identityName(term) === name)).map((record) => [record.id, record])).values()];
  // Ambiguous acronyms are resolved during public research rather than silently merged.
  return !genericNames.has(name) && matches.length === 1 ? matches[0] : undefined;
}

export class KnowledgeCatalogStore {
  constructor(readonly directory = process.env.KNOWLEDGE_DB_DIR || defaultDirectory) {}

  async list(): Promise<KnowledgeRecord[]> {
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const records: KnowledgeRecord[] = [];
    for (const file of files.filter((name) => /^custom-auto-(competition|journal)-[a-f0-9]{32}\.json$/.test(name)).sort()) {
      const raw = JSON.parse(await readFile(path.join(this.directory, file), "utf8"));
      const bundle = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [raw] });
      if ("error" in bundle || bundle.records[0].id + ".json" !== file || !bundle.records[0].origin
        || (bundle.records[0].kind === "competition" ? !bundle.records[0].competition : !bundle.records[0].venue)) {
        throw new Error(`自动资料库条目损坏：${file}。请检查后重试。`);
      }
      // Import validation is shared with backups; runtime catalog text remains lossless.
      records.push(raw as KnowledgeRecord);
    }
    return records;
  }

  async put(record: KnowledgeRecord, existing: KnowledgeRecord[], signal?: AbortSignal): Promise<{ record: KnowledgeRecord; created: boolean }> {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, ".write-lock");
    const until = Date.now() + 5000;
    while (true) {
      signal?.throwIfAborted();
      try { await mkdir(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= until) throw new Error("资料库写入繁忙，请稍后重试；未覆盖已有条目。");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    let temporary: string | undefined;
    try {
      signal?.throwIfAborted();
      const all = [...existing, ...await this.list()];
      const found = all.find((entry) => entry.kind === record.kind && identityName(entry.title) === identityName(record.title))
        ?? findCatalogRecord({ kind: record.kind as CatalogCandidate["kind"], name: record.title }, all);
      if (found) return { record: found, created: false };
      const suffix = createHash("sha256").update(`${record.kind}:${identityName(record.title)}`).digest("hex").slice(0, 32);
      const id = `custom-auto-${record.kind}-${suffix}`;
      const saved = { ...record, id, ...(record.competition ? { competition: { ...record.competition, id } } : {}),
        ...(record.venue ? { venue: { ...record.venue, id } } : {}),
        evidenceSources: record.evidenceSources?.map((source, index) => ({ ...source, id: `${id}-source-${index + 1}` })) };
      const bundle = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1, records: [saved] });
      if ("error" in bundle || !bundle.records[0].origin || (saved.kind === "competition" ? !bundle.records[0].competition : !bundle.records[0].venue)) {
        throw new Error("标准资料字段校验失败，未入库。");
      }
      temporary = path.join(this.directory, `${id}-${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      signal?.throwIfAborted();
      await rename(temporary, path.join(this.directory, `${id}.json`));
      return { record: saved, created: true };
    } finally {
      if (temporary) await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }

  async remove(id: string): Promise<void> {
    if (!/^custom-auto-(competition|journal)-[a-f0-9]{32}$/.test(id)) return;
    await rm(path.join(this.directory, `${id}.json`), { force: true });
  }
}

export const catalogStore = new KnowledgeCatalogStore();
export async function readCustomKnowledge(): Promise<KnowledgeRecord[]> {
  const file = path.join(path.resolve(process.env.RESUME_DIR || ".data/resumes"), ".metadata/knowledge-records.json");
  let custom: KnowledgeRecord[] = [];
  try { custom = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!Array.isArray(custom)) throw new Error("本地资料文件格式无效。");
  const ids = new Set(custom.map((record) => record.id));
  return [...custom, ...(await catalogStore.list()).filter((record) => !ids.has(record.id))];
}
export async function readKnowledgeRecords(): Promise<KnowledgeRecord[]> {
  const custom = await readCustomKnowledge();
  const ids = new Set(custom.map((record) => record.id));
  return [...custom, ...knowledgeRecords.filter((record) => !ids.has(record.id))];
}
