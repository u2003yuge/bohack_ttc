import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBenchmark } from "./history.js";

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
