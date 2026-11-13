import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBenchmark, historicalScoreBand, matchesHistoricalFilters, normalizeHistoricalCandidate, type HistoricalCandidate } from "./history.js";

test("benchmark percentile counts only historical scores strictly below the current score", () => {
  const benchmark = calculateBenchmark("产品经理", 88);
  assert.equal(benchmark.sampleCount, 6);
  assert.equal(benchmark.percentile, 67);
});

test("a score tied with the highest historical sample excludes the tied record", () => {
  const benchmark = calculateBenchmark("产品经理", 91);
  assert.equal(benchmark.percentile, 83);
});

test("a score above the highest historical sample exceeds every sample", () => {
  const benchmark = calculateBenchmark("产品经理", 92);
  assert.equal(benchmark.percentile, 100);
});

test("historical records require valid outcome and score fields", () => {
  assert.deepEqual(normalizeHistoricalCandidate({ role: "开发", year: 2025, composite: 72, screened: false, hired: true }, "id", 1), { error: "最终录取样本必须标记为通过首轮。" });
  const valid = normalizeHistoricalCandidate({ role: "开发", year: 2025, composite: 72.36, screened: true, hired: true }, "id", 1, 2025);
  assert.deepEqual(valid, { id: "id", name: "匿名样本 1", role: "开发", year: 2025, screened: true, hired: true, composite: 72.4 });
});

test("historical score buckets include both endpoints and cover the 0-100 scale", () => {
  assert.equal(historicalScoreBand(0), "0-19");
  assert.equal(historicalScoreBand(19), "0-19");
  assert.equal(historicalScoreBand(20), "20-39");
  assert.equal(historicalScoreBand(79), "60-79");
  assert.equal(historicalScoreBand(80), "80-100");
  assert.equal(historicalScoreBand(100), "80-100");
  assert.equal(historicalScoreBand(-1), null);
  assert.equal(historicalScoreBand(101), null);
});

test("historical score-band and outcome filters intersect without double-counting hires as screen-only", () => {
  const makeCandidate = (id: string, composite: number, screened: boolean, hired: boolean): HistoricalCandidate => ({ id, name: id, role: "产品经理", year: 2025, composite, screened, hired });
  const hired = makeCandidate("hired", 84, true, true);
  const screened = makeCandidate("screened", 74, true, false);
  const rejected = makeCandidate("rejected", 74, false, false);
  assert.equal(matchesHistoricalFilters(hired, "80-100", "hired"), true);
  assert.equal(matchesHistoricalFilters(hired, "80-100", "screened"), false);
  assert.equal(matchesHistoricalFilters(screened, "60-79", "screened"), true);
  assert.equal(matchesHistoricalFilters(rejected, "60-79", "rejected"), true);
  assert.equal(matchesHistoricalFilters(rejected, "80-100", "rejected"), false);
});
