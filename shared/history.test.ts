import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBenchmark, historicalScoreBand, matchesHistoricalFilters, normalizeHistoricalCandidate, normalizeHistoricalFilterDraft, type HistoricalCandidate } from "./history.js";

const benchmarkRecords: HistoricalCandidate[] = [50, 60, 70, 79, 88, 91].map((composite, index) => ({ id: `benchmark-${index}`, name: `样本 ${index + 1}`, role: "产品经理", year: index < 3 ? 2024 : 2025, screened: composite >= 70, hired: composite >= 88, composite }));

test("benchmark percentile counts only historical scores strictly below the current score", () => {
  const benchmark = calculateBenchmark("产品经理", 88, null, benchmarkRecords);
  assert.equal(benchmark.sampleCount, 6);
  assert.equal(benchmark.percentile, 67);
  assert.equal(benchmark.sampleRoleGroup, "product");
});

test("benchmark reports when it falls back from an empty role group to all roles", () => {
  const records: HistoricalCandidate[] = [{ id: "eng", name: "匿名样本", role: "软件工程师", year: 2025, screened: true, hired: true, composite: 82 }];
  const benchmark = calculateBenchmark("产品经理", 80, null, records);
  assert.equal(benchmark.roleGroup, "product");
  assert.equal(benchmark.sampleRoleGroup, "all");
  assert.equal(benchmark.sampleCount, 1);
  assert.equal(benchmark.percentile, 0);
});

test("a score tied with the highest historical sample excludes the tied record", () => {
  const benchmark = calculateBenchmark("产品经理", 91, null, benchmarkRecords);
  assert.equal(benchmark.percentile, 83);
});

test("a score above the highest historical sample exceeds every sample", () => {
  const benchmark = calculateBenchmark("产品经理", 92, null, benchmarkRecords);
  assert.equal(benchmark.percentile, 100);
});

test("benchmark leaves outcome cutoffs unavailable when that outcome has no samples", () => {
  const records: HistoricalCandidate[] = [{ id: "screened", name: "匿名样本", role: "产品经理", year: 2025, screened: true, hired: false, composite: 74 }];
  const benchmark = calculateBenchmark("产品经理", 80, null, records);
  assert.equal(benchmark.percentile, 100);
  assert.equal(benchmark.screenCutoff, 74);
  assert.equal(benchmark.hireCutoff, null);
  assert.equal(benchmark.hiredRate, 0);
});

test("benchmark uses the arithmetic median for an even number of outcome samples", () => {
  const records: HistoricalCandidate[] = [
    { id: "screened-a", name: "A", role: "产品经理", year: 2025, screened: true, hired: false, composite: 70 },
    { id: "screened-b", name: "B", role: "产品经理", year: 2025, screened: true, hired: false, composite: 81 },
    { id: "hired-a", name: "C", role: "产品经理", year: 2025, screened: true, hired: true, composite: 81 },
    { id: "hired-b", name: "D", role: "产品经理", year: 2025, screened: true, hired: true, composite: 89 },
  ];
  const benchmark = calculateBenchmark("产品经理", 80, null, records);
  assert.equal(benchmark.screenCutoff, 81);
  assert.equal(benchmark.hireCutoff, 85);
});

test("benchmark returns unavailable comparisons rather than NaN for an empty history", () => {
  const benchmark = calculateBenchmark("产品经理", 80, null, []);
  assert.equal(benchmark.sampleCount, 0);
  assert.equal(benchmark.percentile, null);
  assert.equal(benchmark.screenCutoff, null);
  assert.equal(benchmark.hireCutoff, null);
  assert.equal(benchmark.screenedRate, 0);
  assert.equal(benchmark.hiredRate, 0);
});

test("historical records require valid outcome and score fields", () => {
  assert.deepEqual(normalizeHistoricalCandidate({ role: "开发", year: 2025, composite: 72, screened: false, hired: true }, "id", 1), { error: "最终录取样本必须标记为通过首轮。" });
  assert.equal("error" in normalizeHistoricalCandidate({ role: "开发", year: 2026, composite: 72, screened: true, hired: false }, "id", 1), true);
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

test("historical filter drafts accept only currently available values", () => {
  const options = { roleGroups: ["product", "data"], years: [2024, 2025] };
  assert.deepEqual(normalizeHistoricalFilterDraft({ roleGroup: "data", year: 2025, scoreBand: "80-100", outcome: "screened", rationale: "查看高分首轮样本" }, options), {
    roleGroup: "data", year: 2025, scoreBand: "80-100", outcome: "screened", rationale: "查看高分首轮样本",
  });
  assert.equal("error" in normalizeHistoricalFilterDraft({ roleGroup: "finance", year: 2025, scoreBand: "80-100", outcome: "hired" }, options), true);
  assert.equal("error" in normalizeHistoricalFilterDraft({ roleGroup: "all", year: 2023, scoreBand: "80-100", outcome: "all" }, options), true);
  assert.equal("error" in normalizeHistoricalFilterDraft({ roleGroup: "all", year: "all", scoreBand: "invalid", outcome: "all" }, options), true);
});
