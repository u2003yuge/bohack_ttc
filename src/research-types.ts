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

export type ResearchBatch = { items: ResearchResult[]; notes: string[] };

export type AnalysisProgress = {
  stage: "extracting" | "researching" | "analyzing";
  message: string;
  completed?: number;
  total?: number;
};

export type AnalysisEvent =
  | { type: "answer"; text: string; replace?: boolean }
  | { type: "progress"; progress: AnalysisProgress }
  | { type: "research"; research: ResearchBatch }
  | { type: "complete"; answer: string; research: ResearchBatch }
  | { type: "error"; error: string; research?: ResearchBatch }
  | { type: "heartbeat" };
