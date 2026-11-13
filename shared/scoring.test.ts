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
  assert.equal(draft.rationale.length, 240);
});

test("comparison rank drafts default to all rating sources for older agent responses", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "composite", direction: "desc" });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.ratingFilter, "all");
});

test("comparison rank drafts reject invented dimensions and directions", () => {
  assert.deepEqual(normalizeComparisonRankDraft({ criterion: "candidate-name", direction: "random" }), {
    error: "排名方案包含无效的评分维度或方向，请重新生成。",
  });
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", ratingFilter: "unreviewed-plus" }));
});
