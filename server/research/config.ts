import { readFileSync } from "node:fs";
import OpenAI from "openai";
import type { ResearchKind } from "../../src/research-types.js";
import { limit } from "../operations.js";

export const definitions = {
  competition: {
    directory: "competition-award-evaluator",
    template: "result-template.json",
    references: ["output-schema.md"],
    fields: ["competition_name", "award_name", "award_year", "age_at_award"],
    required: ["competition_name", "award_name", "award_year"],
    context: ["division", "track", "stage", "region"],
    identitySection: "competition",
    identityField: "official_name",
  },
  paper: {
    directory: "paper-value-evaluator",
    template: "result-template.json",
    references: ["output-format.md", "sources-and-levels.md"],
    fields: ["title", "description"],
    required: ["title"],
    context: ["authors", "year", "doi", "arxiv_id", "url", "track", "version"],
    identitySection: "paper",
    identityField: "official_title",
  },
  project: {
    directory: "resume-project-research",
    template: "report-template.json",
    references: ["output-format.md"],
    fields: ["project_name", "project_year", "organization", "role"],
    required: ["project_name", "project_year", "organization"],
    context: [],
    identitySection: "project",
    identityField: "official_name",
  },
} satisfies Record<ResearchKind, {
  directory: string; template: string; references: string[];
  fields: string[]; required: string[]; context: string[];
  identitySection: string; identityField: string;
}>;

export function loadSkill(kind: ResearchKind) {
  const definition = definitions[kind];
  const root = new URL(`../skills/${definition.directory}/`, import.meta.url);
  const template = JSON.parse(readFileSync(new URL(`assets/${definition.template}`, root), "utf8")) as Record<string, unknown>;
  const instructions = ["SKILL.md", ...definition.references.map((name) => `references/${name}`)]
    .map((name) => readFileSync(new URL(name, root), "utf8")).join("\n\n");
  return { template, instructions };
}

export function modelClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("尚未配置 OPENAI_API_KEY。");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: limit("MODEL_REQUEST_TIMEOUT_MS", 60_000),
    maxRetries: 0,
  });
}

export function parseJson(content: string): unknown {
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
