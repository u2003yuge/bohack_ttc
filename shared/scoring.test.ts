import assert from "node:assert/strict";
import test from "node:test";
import { comparisonMapQuadrants, matchesComparisonMapRegion, normalizeComparisonRankDraft } from "./scoring.js";

test("comparison rank drafts accept supported dimensions and source filters", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "expertise", direction: "desc", ratingFilter: "scored", rationale: "x".repeat(300) });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.criterion, "expertise");
  assert.equal(draft.direction, "desc");
  assert.equal(draft.ratingFilter, "scored");
  assert.equal(draft.mapX, "perspective");
  assert.equal(draft.mapY, "depth");
  assert.equal(draft.mapRegion, "all");
  assert.equal(draft.mapThreshold, 50);
  assert.equal(draft.rationale.length, 240);
});

test("comparison rank drafts default to all rating sources for older agent responses", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "composite", direction: "desc" });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.ratingFilter, "all");
  assert.equal(draft.mapX, "perspective");
  assert.equal(draft.mapY, "depth");
  assert.equal(draft.mapRegion, "all");
  assert.equal(draft.mapThreshold, 50);
});

test("comparison rank drafts accept distinct custom quality-map axes", () => {
  const draft = normalizeComparisonRankDraft({ criterion: "roleFit", direction: "desc", mapX: "experience", mapY: "expertise", mapRegion: "high-high", mapThreshold: 65 });
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.equal(draft.mapX, "experience");
  assert.equal(draft.mapY, "expertise");
  assert.equal(draft.mapRegion, "high-high");
  assert.equal(draft.mapThreshold, 65);
});

test("comparison rank drafts retain current settings when a model response omits fields", () => {
  const current = { criterion: "expertise" as const, direction: "asc" as const, ratingFilter: "scored" as const, mapX: "experience" as const, mapY: "roleFit" as const, mapRegion: "low-high" as const, mapThreshold: 62, rationale: "" };
  const draft = normalizeComparisonRankDraft({}, current);
  assert.equal("error" in draft, false);
  if ("error" in draft) return;
  assert.deepEqual(draft, current);
});

test("quality-map quadrant filters use a stable 50-point threshold on each axis", () => {
  assert.equal(matchesComparisonMapRegion(50, 50, "high-high"), true);
  assert.equal(matchesComparisonMapRegion(80, 49, "high-low"), true);
  assert.equal(matchesComparisonMapRegion(49, 80, "low-high"), true);
  assert.equal(matchesComparisonMapRegion(49, 49, "low-low"), true);
  assert.equal(matchesComparisonMapRegion(65, 66, "high-high", 65), true);
  assert.equal(matchesComparisonMapRegion(64, 66, "low-high", 65), true);
  assert.equal(matchesComparisonMapRegion(50, 49, "high-high"), false);
  assert.equal(matchesComparisonMapRegion(25, 95, "all"), true);
});

test("quality-map quadrant labels stay centered in regions when the threshold changes", () => {
  for (const threshold of [20, 50, 80]) {
    const [lowHigh, highHigh, lowLow, highLow] = comparisonMapQuadrants(10, 20, 600, 300, threshold);
    assert.equal(lowHigh.x, 10);
    assert.equal(lowHigh.y, 20);
    assert.ok(Math.abs(lowHigh.width - 600 * threshold / 100) < 1e-10);
    assert.ok(Math.abs(highHigh.x - (10 + 600 * threshold / 100)) < 1e-10);
    assert.ok(Math.abs(lowLow.y - (20 + 300 * (1 - threshold / 100))) < 1e-10);
    assert.ok(Math.abs(highLow.x + highLow.width - 610) < 1e-10);
    for (const quadrant of [lowHigh, highHigh, lowLow, highLow]) {
      assert.ok(Math.abs(quadrant.centerX - (quadrant.x + quadrant.width / 2)) < 1e-10);
      assert.ok(Math.abs(quadrant.centerY - (quadrant.y + quadrant.height / 2)) < 1e-10);
    }
  }
});

test("comparison rank drafts reject invented dimensions and directions", () => {
  assert.deepEqual(normalizeComparisonRankDraft({ criterion: "candidate-name", direction: "random" }), {
    error: "排名方案包含无效的评分维度或方向，请重新生成。",
  });
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", ratingFilter: "unreviewed-plus" }));
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", mapX: "unknown", mapY: "depth" }));
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", mapX: "expertise", mapY: "expertise" }));
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", mapRegion: "top-performer" }));
  assert.ok("error" in normalizeComparisonRankDraft({ criterion: "composite", direction: "desc", mapThreshold: 81 }));
});
