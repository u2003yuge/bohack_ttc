import type { Resume } from "./types.js";
import type { Assessment } from "../shared/material-scoring.js";

export type AgentTiming = { id: string; label: string; stage: number; startedAtMs: number; durationMs: number; reused: boolean; parallelWith: string[] };
export type AgentDebug = { totalDurationMs: number; maxParallel: number; timings: AgentTiming[] };

export type ResearchKind = "competition" | "paper" | "project";

export type ResearchInput = Record<string, string | number | null>;

export type ResearchItem = {
  kind: ResearchKind;
  input: ResearchInput;
  context: Record<string, string | null>;
  evidence: string;
  missingFields: string[];
  notes: string[];
};

export type ResearchReport = {
  input: Record<string, unknown>;
  sources: Array<{ title: string; url: string | null; information: string }>;
  notes: string[];
  [section: string]: unknown;
};

export type ResearchResult = {
  item: ResearchItem;
  status: "cached" | "researched" | "pending" | "error";
  report: ResearchReport | null;
  error: string | null;
};

export type CatalogCandidate = { kind: "competition" | "journal"; name: string; evidence: string };
export type CatalogResult = { kind: CatalogCandidate["kind"]; name: string; status: "existing" | "created" | "pending" | "error"; knowledgeId?: string; message: string };
export type ResearchBatch = { items: ResearchResult[]; notes: string[]; catalog?: CatalogResult[] };

export type AnalysisResult = {
  answer: string;
  research: ResearchBatch;
  assessment?: Assessment;
  resume?: Resume;
  researchSources?: never;
  researchStatus?: "not-requested";
  debug?: AgentDebug;
};

export type AnalysisProgress = {
  stage: "extracting" | "researching" | "scoring" | "analyzing";
  message: string;
  completed?: number;
  total?: number;
};

export type AnalysisEvent =
  | { type: "answer"; text: string; replace?: boolean }
  | { type: "agent"; agentId: string; label: string; markdown: string; reused: boolean; completed: number; total: number; timing?: AgentTiming }
  | { type: "progress"; progress: AnalysisProgress }
  | { type: "assessment"; assessment: Assessment }
  | ({ type: "complete" } & AnalysisResult)
  | { type: "error"; error: string; research?: ResearchBatch }
  | { type: "heartbeat" };
