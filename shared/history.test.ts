import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBenchmark, normalizeHistoricalCandidate } from "./history.js";

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
