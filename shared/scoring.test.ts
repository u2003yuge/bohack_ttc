import assert from "node:assert/strict";
import test from "node:test";
import { normalizeComparisonRankDraft } from "./scoring.js";

test("comparison rank drafts accept supported dimensions and source filters", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "expertise", direction: "desc", ratingFilter: "scored", rationale: "x".repeat(300) });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.criterion, "expertise");
  assert.equal(draft.direction, "desc");
  assert.equal(draft.ratingFilter, "scored");
  assert.equal(draft.mapX, "perspective");
  assert.equal(draft.mapY, "depth");
  assert.equal(draft.rationale.length, 240);
});

test("comparison rank drafts default to all rating sources for older agent responses", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "composite", direction: "desc" });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.ratingFilter, "all");
  assert.equal(draft.mapX, "perspective");
  assert.equal(draft.mapY, "depth");
});

test("comparison rank drafts accept distinct custom quality-map axes", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "roleFit", direction: "desc", mapX: "experience", mapY: "expertise" });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.mapX, "experience");
  assert.equal(draft.mapY, "expertise");
});

test("comparison rank drafts retain current settings when a model response omits fields", () => {
  const current = { criterion: "expertise" as const, direction: "asc" as const, ratingFilter: "scored" as const, mapX: "experience" as const, mapY: "roleFit" as const, rationale: "" };
  const draft = normalizeComparisonRankDraft({}, current);
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.deepEqual(draft, current);
});

test("comparison rank drafts reject invented dimensions and directions", () => {
  assert.deepEqual(normalizeComparisonRankDraft({ criterion: "candidate-name", direction: "random" }), {
    error: "排名方案包含无效的评分维度或方向，请重新生成。",
  });
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", ratingFilter: "unreviewed-plus" }));
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", mapX: "unknown", mapY: "depth" }));
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", mapX: "expertise", mapY: "expertise" }));
});
