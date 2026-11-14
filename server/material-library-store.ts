import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeRecord } from "../shared/knowledge.js";
import { materialLibraryEntries, matchMaterialKnowledge } from "../shared/material-library.js";
import {
  withMaterialContributions,
  type Assessment,
  type AssessmentHistoryEntry,
  type LibraryMaterialScore,
} from "../shared/material-scoring.js";
import { catalogCandidateId, catalogCandidateName } from "./scoring/catalog.js";

export type MaterialLibraryDocument = {
  format: "bohack-material-library";
  version: 1;
  candidates: Record<
    string,
    {
      assessmentId: string;
      fingerprint: string;
      entries: LibraryMaterialScore[];
      history: LibraryMaterialScore[];
    }
  >;
};
type Candidate = {
  id: string;
  name: string;
  source?: string;
  assessment?: Assessment;
  assessmentHistory?: AssessmentHistoryEntry[];
};

export class MaterialLibraryStore {
  private pending: Promise<unknown> = Promise.resolve();
  readonly file: string;
  constructor(
    readonly metadataDirectory = path.resolve(process.env.RESUME_DIR || ".data/resumes", ".metadata"),
  ) {
    this.file = path.join(metadataDirectory, "material-library.json");
  }

  async read(): Promise<MaterialLibraryDocument> {
    try {
      const document = JSON.parse(await readFile(this.file, "utf8")) as MaterialLibraryDocument;
      if (
        document.format !== "bohack-material-library" ||
        document.version !== 1 ||
        !document.candidates ||
        typeof document.candidates !== "object"
      )
        throw new Error("材料评分资料库格式无效。");
      return document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { format: "bohack-material-library", version: 1, candidates: {} };
      throw error;
    }
  }

  private async commit(document: MaterialLibraryDocument, signal?: AbortSignal) {
    await mkdir(this.metadataDirectory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(document, null, 2), { encoding: "utf8", flag: "wx", signal });
      signal?.throwIfAborted();
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  save(candidate: Candidate, records: KnowledgeRecord[], signal?: AbortSignal): Promise<void> {
    const job = this.pending
      .catch(() => undefined)
      .then(async () => {
        if (!candidate.assessment) return;
        signal?.throwIfAborted();
        const document = await this.read();
        const assessments = [
          ...(candidate.assessmentHistory ?? []).map((entry) => entry.assessment),
          candidate.assessment,
        ];
        const unique = [...new Map(assessments.map((assessment) => [assessment.id, assessment])).values()];
        const history = unique.flatMap((assessment) =>
          materialLibraryEntries(candidate, withMaterialContributions(assessment)),
        );
        const entries = materialLibraryEntries(candidate, withMaterialContributions(candidate.assessment));
        for (const entry of [...history, ...entries]) {
          entry.knowledgeIds = matchMaterialKnowledge(entry, records);
        }
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ assessmentId: candidate.assessment.id, history, entries }))
          .digest("hex");
        if (document.candidates[candidate.id]?.fingerprint === fingerprint) return;
        document.candidates[candidate.id] = {
          assessmentId: candidate.assessment.id,
          fingerprint,
          entries,
          history,
        };
        await this.commit(document, signal);
      });
    this.pending = job;
    return job;
  }

  async list(records: KnowledgeRecord[]): Promise<LibraryMaterialScore[]> {
    await this.pending;
    const document = await this.read();
    return Object.values(document.candidates).flatMap((candidate) =>
      candidate.entries.map((entry) => ({
        ...entry,
        knowledgeIds: matchMaterialKnowledge(entry, records),
      })),
    );
  }

  saveCatalog(assessment: Assessment, records: KnowledgeRecord[], signal?: AbortSignal): Promise<void> {
    const job = this.pending
      .catch(() => undefined)
      .then(async () => {
        signal?.throwIfAborted();
        const document = await this.read();
        const entries = materialLibraryEntries(
          { id: catalogCandidateId, name: catalogCandidateName },
          withMaterialContributions(assessment),
        );
        for (const entry of entries) entry.knowledgeIds = matchMaterialKnowledge(entry, records);
        const fingerprintEntries = entries.map(({ assessmentId: _assessmentId, evaluatedAt: _evaluatedAt, ...entry }) => entry);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(fingerprintEntries))
          .digest("hex");
        if (document.candidates[catalogCandidateId]?.fingerprint === fingerprint) return;
        document.candidates[catalogCandidateId] = {
          assessmentId: assessment.id,
          fingerprint,
          entries,
          history: [],
        };
        await this.commit(document, signal);
      });
    this.pending = job;
    return job;
  }
}

export const materialLibraryStore = new MaterialLibraryStore();
