import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeKnowledgeEnrichment } from "./analysis.js";

const sources = [
  { title: "Official venue", url: "https://neurips.cc/", snippet: "Conference website" },
  { title: "University news", url: "https://university.example/news", snippet: "A research story" },
];

test("knowledge enrichment only keeps a source URL returned by search", () => {
  const normalized = normalizeKnowledgeEnrichment({ officialUrl: "https://fake.example/", confidence: 1.4 }, sources);
  assert.equal(normalized.officialUrl, "");
  assert.equal(normalized.confidence, 1);
});

test("knowledge enrichment bounds generated lists and accepts exact source URLs", () => {
  const normalized = normalizeKnowledgeEnrichment({
    aliases: Array.from({ length: 12 }, (_, index) => `alias-${index}`),
    signals: Array.from({ length: 9 }, (_, index) => `signal-${index}`),
    officialUrl: "https://neurips.cc/",
    confidence: 0.6,
  }, sources);
  assert.equal(normalized.officialUrl, "https://neurips.cc/");
  assert.equal(normalized.aliases.length, 8);
  assert.equal(normalized.signals.length, 6);
});
