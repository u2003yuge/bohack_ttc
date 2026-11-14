export type Experience = {
  company: string;
  role: string;
  period: string;
  detail: string;
};

export type Resume = {
  id: string;
  name: string;
  role: string;
  location: string;
  received: string;
  initials: string;
  source: "demo" | "pdf";
  text: string;
  experiences?: Experience[];
  education: string;
  skills: string[];
  summary?: string;
  analysisReport?: string;
  scoreCard?: ScoreCard;
  scoreHistory?: ScoreHistoryEntry[];
  assessment?: Assessment;
  assessmentHistory?: AssessmentHistoryEntry[];
  benchmark?: Benchmark;
  analysisStatus?: "complete" | "unavailable" | "failed";
  analysisError?: string;
  analyzedAt?: string;
  fileName?: string;
  pages?: number;
  size?: number;
};
import type { ScoreCard, ScoreHistoryEntry } from "../shared/scoring.js";
import type { Benchmark } from "../shared/history.js";
import type { Assessment, AssessmentHistoryEntry } from "../shared/material-scoring.js";
