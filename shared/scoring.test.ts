import assert from "node:assert/strict";
import test from "node:test";
import { normalizeComparisonRankDraft } from "./scoring.js";

test("comparison rank drafts accept supported skill dimensions and bound their rationale", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "expertise", direction: "desc", rationale: "x".repeat(300) });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.criterion, "expertise");
  assert.equal(draft.direction, "desc");
  assert.equal(draft.rationale.length, 240);
});

test("comparison rank drafts reject invented dimensions and directions", () => {
  assert.deepEqual(normalizeComparisonRankDraft({ criterion: "candidate-name", direction: "random" }), {
    error: "排名方案包含无效的评分维度或方向，请重新生成。",
  });
});
