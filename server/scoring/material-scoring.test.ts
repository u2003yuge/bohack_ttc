import assert from "node:assert/strict";
import test from "node:test";
import {
  abilityDimensions,
  actionLevels,
  decayRatio,
  evaluateCondition,
  factorDefinitions,
  normalizeJobPreference,
  presetPreference,
  rankAssessment,
  scoreMaterials,
  scoringVersion,
  typeAdaptation,
  type MaterialInput,
} from "../../shared/material-scoring.js";
import {
  completeAction,
  fullProjectValues,
  ordinaryProjectValues,
  sampleMaterial,
  scoringSamples,
} from "../../shared/scoring-samples.js";
import type { ResearchBatch } from "../../src/research-types.js";
import { enrichMaterialFacts, extractMaterialsByRules, normalizeMaterialExtraction } from "./materials.js";
import { createAssessment } from "./pipeline.js";
import { preferenceByRules } from "./preferences.js";

const close = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
const byId = (id: string) => structuredClone(scoringSamples.find((s) => s.id === id)!.material);
test("七类权重均合计 1；适配矩阵和行动系数有固定数值", () => {
  assert.equal(Object.keys(factorDefinitions).length, 7);
  for (const [type, factors] of Object.entries(factorDefinitions)) {
    close(
      factors.reduce((s, f) => s + f.weight, 0),
      1,
    );
    for (const { key } of abilityDimensions)
      assert.ok(typeAdaptation[type as keyof typeof typeAdaptation][key] >= 0);
  }
  assert.deepEqual(Object.values(actionLevels), [0.25, 0.5, 0.75, 1]);
  assert.equal(decayRatio, 0.5);
});
test("30 条合成标注种子覆盖所有父类型，积分有限且非负", () => {
  assert.equal(scoringSamples.length, 30);
  assert.equal(new Set(scoringSamples.map((s) => s.material.material_type)).size, 7);
  for (const sample of scoringSamples) {
    const { materials } = scoreMaterials([sample.material]);
    assert.ok(
      materials[0].material_score === null ||
        (Number.isFinite(materials[0].material_score) && materials[0].material_score >= 0),
    );
    assert.ok(materials[0].score_coverage >= 0 && materials[0].score_coverage <= 1);
  }
});
test("奖项公式使用对数规模、官方比例和明确因素权重，并保留非负积分", () => {
  const m = byId("S01");
  const result = scoreMaterials([m]).materials[0];
  assert.ok(result.material_score! >= 0);
  assert.equal(result.score_coverage, 1);
});
test("竞赛先算赛事质量，再用官方选择性和实际获奖层级形成表现比例", () => {
  const result = scoreMaterials([byId("S01")]).materials[0];
  close(result.event_score, 96.051742);
  close(result.performance_ratio, 0.85);
  close(result.material_score, 81.643981);
  assert.equal(result.score_breakdown.find((factor) => factor.key === "tier")?.contribution, null);
  assert.equal(result.score_breakdown.find((factor) => factor.key === "award_rate")?.contribution, null);
  assert.ok(result.material_score! < result.event_score!);
});
test("未知保持 null，实际为零的因素仍是已知零", () => {
  const unknown = scoreMaterials([byId("S29")]);
  assert.equal(unknown.materials[0].material_score, null);
  assert.equal(unknown.materials[0].score_coverage, 0);
  assert.ok(abilityDimensions.every(({ key }) => unknown.abilities[key].score === null));
  const zero = sampleMaterial("award", "零规模合成", "零规模合成赛事明确为零。", { participants: 0 });
  assert.equal(scoreMaterials([zero]).materials[0].material_score, null);
  assert.equal(scoreMaterials([zero]).materials[0].score_coverage, 0.5);
});
test("部分因素只累计已知贡献，不按覆盖率放大", () => {
  const result = scoreMaterials([byId("S06")]).materials[0];
  assert.equal(result.material_score, null);
  assert.equal(result.event_score, null);
  assert.equal(result.performance_ratio, null);
  assert.ok(result.missing_factors.includes("官方目标奖项比例（表现比例）"));
});
test("同材料多处展示不重复加分，同赛事不同年份独立保留", () => {
  const one = scoreMaterials([byId("S01")]);
  const repeated = scoreMaterials([byId("S01"), byId("S04")]);
  assert.equal(repeated.materials.length, 1);
  assert.equal(repeated.materials[0].merged_from.length, 2);
  assert.deepEqual(repeated.abilities, one.abilities);
  assert.equal(scoreMaterials([byId("S01"), byId("S05")]).materials.length, 2);
});
test("同名不同机构与独立阶段不误合并", () => {
  assert.equal(scoreMaterials([byId("S12"), byId("S15"), byId("S16")]).materials.length, 3);
});
test("DOI 相同的预印本、会议版、期刊版只算一项并升级状态", () => {
  const result = scoreMaterials([byId("S07"), byId("S08"), byId("S09")]);
  assert.equal(result.materials.length, 1);
  assert.equal(result.materials[0].material_score, result.materials[0].score_breakdown.reduce((sum, factor) => sum + (factor.contribution ?? 0), 0));
  assert.equal(result.materials[0].merged_from.length, 3);
});
test("第三条来源把 arXiv 和 DOI 连接起来时，去重具有传递性", () => {
  const a = byId("S07"),
    b = byId("S08"),
    bridge = byId("S09");
  a.identifiers = ["arxiv:2401.00001"];
  b.identifiers = ["10.9999/synthetic-1"];
  bridge.identifiers = [...a.identifiers, ...b.identifiers];
  assert.equal(scoreMaterials([a, b, bridge]).materials.length, 1);
  assert.equal(scoreMaterials([bridge, a, b]).materials.length, 1);
});
test("团队奖、高质量项目和个人头衔没有行动时不产生能力分", () => {
  for (const id of ["S03", "S13", "S18", "S25"]) {
    const result = scoreMaterials([byId(id)]);
    assert.ok(
      abilityDimensions.every(({ key }) => result.abilities[key].score === null),
      id,
    );
  }
});
test("一项材料仅支持有行动证据的能力，明确分工不因团队规模加协作分", () => {
  const result = scoreMaterials([byId("S12")]);
  assert.ok(result.abilities.professional_execution.score! > 0);
  assert.equal(result.abilities.collaboration_organization.score, null);
  assert.equal(result.abilities.learning_research.score, null);
});
test("几何递减按派生贡献排序，而不是原材料分排序", () => {
  const high = sampleMaterial(
    "project",
    "高材料弱映射",
    "我在指导下协助开发高材料弱映射模块。",
    fullProjectValues,
  );
  const ordinary = sampleMaterial(
    "project",
    "普通强映射",
    "我独立负责开发普通强映射模块，在任务约束下完成原型并测试通过，开展试点。",
    ordinaryProjectValues,
  );
  const result = scoreMaterials([high, ordinary]);
  assert.equal(result.materials[0].material_score, result.materials[0].score_breakdown.reduce((sum, factor) => sum + (factor.contribution ?? 0), 0));
  assert.equal(result.materials[1].material_score, result.materials[1].score_breakdown.reduce((sum, factor) => sum + (factor.contribution ?? 0), 0));
  assert.equal(result.abilities.professional_execution.terms[0].title, "普通强映射");
  const expected = result.abilities.professional_execution.terms.reduce((sum, term) => sum + term.contribution, 0);
  assert.equal(result.abilities.professional_execution.score, expected);
});
test("不同材料父类型各自从权重 1 开始，跨类型贡献直接相加", () => {
  const a = byId("S11"),
    b = byId("S17");
  const first = scoreMaterials([a]).abilities.professional_execution.score!;
  const second = scoreMaterials([b]).abilities.professional_execution.score!;
  const both = scoreMaterials([a, b]);
  close(both.abilities.professional_execution.score, first + second);
  assert.ok(both.abilities.professional_execution.terms.every((term) => term.decay === 1));
});
test("高质量单项可以压过大量普通同类项，rho 对数量积累生效", () => {
  const low = Array.from({ length: 30 }, (_, i) => ({ ...byId("S12"), title: `普通项目 ${i}` }));
  const high = scoreMaterials([byId("S11")]).type_summaries.find((t) => t.type === "project")!.score!;
  const repeated = scoreMaterials(low).type_summaries.find((t) => t.type === "project")!.score!;
  assert.ok(high > repeated);
  const f = (rho: number) => scoreMaterials(low, rho).type_summaries.find((t) => t.type === "project")!.score!;
  assert.ok(f(0.4) < f(0.5) && f(0.5) < f(0.65));
});
test("数值来源冲突后后续重复记录不能把争议因素重新补回", () => {
  const a = byId("S01"),
    b = structuredClone(a),
    c = structuredClone(a);
  b.factor_observations.participants.value = 200000;
  const m = scoreMaterials([a, b, c]).materials[0];
  assert.ok(m.missing_factors.includes("有效参赛规模"));
  assert.ok(m.evidence_states.includes("冲突/未能消歧"));
});
test("非状态因素档位冲突不能自动挑高分", () => {
  const a = byId("S11"),
    b = structuredClone(a),
    c = structuredClone(a);
  b.factor_observations.complexity.value = "bounded";
  const material = scoreMaterials([a, b, c]).materials[0];
  assert.ok(material.missing_factors.includes("问题复杂度"));
  assert.ok(material.evidence_states.includes("冲突/未能消歧"));
});
test("岗位权重改变排序结果，但材料分和能力画像保持原样", () => {
  const profile = createAssessment(completeAction, [byId("S11"), byId("S17")]);
  const job = presetPreference();
  const changed = normalizeJobPreference({ ...job, weights: { ...job.weights, professional_execution: 10 } });
  const first = rankAssessment(profile, job, completeAction),
    second = rankAssessment(profile, changed, completeAction);
});
test("排序缺少所需维度时保持待核实，不把 NA 当零或重分配权重", () => {
  const profile = createAssessment("合成", [byId("S12")]);
  const result = rankAssessment(profile, presetPreference(), "合成");
  assert.equal(result.score, null);
  assert.equal(result.status, "pending");
  assert.ok(result.knownContribution > 0);
  assert.ok(result.missing.includes("协作与组织"));
});
test("只给已知维度配置权重可以比较；旧评分版本不能混排", () => {
  const profile = createAssessment("合成", [byId("S12")]);
  const job = normalizeJobPreference({
    title: "执行岗",
    weights: Object.fromEntries(
      abilityDimensions.map(({ key }) => [key, key === "professional_execution" ? 1 : 0]),
    ),
  });
  assert.ok(rankAssessment(profile, job, "合成").score! > 0);
  assert.equal(
    rankAssessment({ ...profile, version: "old" as typeof scoringVersion }, job, "合成").score,
    null,
  );
  assert.equal(rankAssessment({ ...profile, rho: 0.65 }, job, "合成").score, null);
});
test("岗位条件区分支持、否定、缺失和冲突；复杂年限不猜测", () => {
  assert.equal(evaluateCondition("Python", "开发 Python 服务。").status, "supported");
  assert.equal(evaluateCondition("Python", "不会 Python。").status, "contradicted");
  assert.equal(evaluateCondition("Python", "熟悉 SQL。").status, "unknown");
  assert.equal(evaluateCondition("Python", "熟悉 Python。不会 Python。").status, "conflict");
  assert.equal(evaluateCondition("至少3年Python经验", "开发 Python 服务。").status, "unknown");
  assert.equal(evaluateCondition("Java", "开发 JavaScript 服务。").status, "unknown");
  assert.equal(evaluateCondition("Python", "没有 Java 经验，熟悉 Python。").status, "supported");
  assert.equal(evaluateCondition("Python", "not familiar with Python").status, "contradicted");
});
test("无候选人事实的偏好规则解析明确比例并归一化", () => {
  const result = preferenceByRules(
    "专业执行45%，责任与交付35%，问题解决20%，必须 Python",
    presetPreference(),
  );
  close(result.weights.professional_execution, 0.45);
  close(result.weights.ownership_delivery, 0.35);
  close(result.weights.problem_solving, 0.2);
  assert.equal(result.weights.learning_research, 0);
  assert.deepEqual(result.must_have, ["Python"]);
});
test("无效权重与敏感条件被拒绝", () => {
  assert.throws(() =>
    normalizeJobPreference({ ...presetPreference(), weights: { ...presetPreference().weights, growth: 1 } }),
  );
  assert.throws(() =>
    normalizeJobPreference({
      ...presetPreference(),
      weights: { ...presetPreference().weights, professional_execution: -1 },
    }),
  );
  assert.throws(() => normalizeJobPreference({ ...presetPreference(), must_have: ["年龄小于30"] }));
  assert.throws(() =>
    normalizeJobPreference({
      ...presetPreference(),
      weights: Object.fromEntries(abilityDimensions.map(({ key }) => [key, Number.MAX_VALUE])),
    }),
  );
});
test("名气、姓名、年龄和排版变化不进入规则积分", () => {
  const a = byId("S11"),
    b = structuredClone(a);
  b.title = "名校 / 大厂 / 不同姓名";
  b.organization = "不同机构";
  b.notes.push("年龄、性别和学校信息只作无关背景。");
  assert.equal(
    scoreMaterials([a]).materials[0].material_score,
    scoreMaterials([b]).materials[0].material_score,
  );
  for (const { key } of abilityDimensions)
    assert.equal(scoreMaterials([a]).abilities[key].score, scoreMaterials([b]).abilities[key].score);
});
test("材料提取验证原文、年份和动作，忽略模型自造分数", () => {
  const text = "2024 合成系统项目，我负责开发接口并完成上线。";
  const value = {
    items: [
      {
        material_type: "project",
        title: "合成系统项目",
        year: 2025,
        organization: "不存在的公司",
        resume_claim: text,
        personal_actions: ["我带领五十人团队"],
        material_score: 9999,
      },
    ],
  };
  const result = normalizeMaterialExtraction(value, text).materials[0];
  assert.equal(result.year, null);
  assert.equal(result.organization, null);
  assert.deepEqual(result.personal_action_evidence, []);
  assert.deepEqual(result.factor_observations, {});
  assert.equal(
    normalizeMaterialExtraction({ items: [{ ...value.items[0], resume_claim: "编造的原文" }] }, text)
      .materials.length,
    0,
  );
});
test("保守规则抽取可处理七类材料，外部岗位职责不进入个人行动", () => {
  const text =
    "算法竞赛一等奖。论文 Synthetic paper。项目设备系统开发。工作经历负责交付模块。调度专利已授权。开源工具修复测试。高级课程实操考核。";
  assert.equal(new Set(extractMaterialsByRules(text).materials.map((m) => m.material_type)).size, 7);
  const material = sampleMaterial("project", "大平台", "参与大平台项目。", fullProjectValues);
  material.personal_action_evidence = [{ origin: "research", quote: completeAction, source: "公开岗位职责" }];
  assert.ok(abilityDimensions.every(({ key }) => scoreMaterials([material]).abilities[key].score === null));
});
function awardResearch(
  awardRate: string | null,
  official = true,
): { input: MaterialInput; batch: ResearchBatch } {
  const input = sampleMaterial("award", "合成官方赛", "2024 合成官方赛二等奖。", {});
  input.result = "二等奖";
  const batch: ResearchBatch = {
    items: [
      {
        item: {
          kind: "competition",
          input: { competition_name: input.title },
          context: {},
          evidence: input.resume_claim,
          missingFields: [],
          notes: [],
        },
        status: "researched",
        error: null,
        report: {
          input: { award_name: "二等奖" },
          competition: { official_website: official ? "https://synthetic.invalid/" : null },
          year_data: {
            participants: "2024 年本科组有效参赛 1200 队",
            winners: "36 队",
            award_rate: awardRate,
            award_structure: "一等奖、二等奖、三等奖",
          },
          prizes_and_rules: { judging_rules: "按测试用例评审" },
          sources: [
            {
              title: "合成官方资料",
              url: "https://synthetic.invalid/results",
              information: "2024 年有效参赛规模、官方获奖比例和评审规则（虚构）。",
            },
          ],
          notes: [],
        },
      },
    ],
    notes: [],
  };
  return { input, batch };
}
test("未公布比例时不自行计算，目标二等奖不继承赛事一等奖", () => {
  const { input, batch } = awardResearch(null);
  const result = enrichMaterialFacts([input], batch)[0];
  assert.equal(result.factor_observations.award_rate, undefined);
  assert.equal(result.factor_observations.tier.value, "second");
});
test("比例只使用官方已公布数据，且规模数字不误读成年份", () => {
  const { input, batch } = awardResearch("3%");
  const result = enrichMaterialFacts([input], batch)[0];
  assert.equal(result.factor_observations.participants.value, 1200);
  assert.equal(result.factor_observations.award_rate.value, 0.03);
  const missing = awardResearch("3%", false);
  assert.equal(
    enrichMaterialFacts([missing.input], missing.batch)[0].factor_observations.award_rate,
    undefined,
  );
});
test("来源标签不作为额外分数系数", () => {
  const a = byId("S11"),
    b = structuredClone(a);
  b.evidence_states = ["独立来源支持个人贡献"];
  assert.deepEqual(scoreMaterials([a]).abilities, scoreMaterials([b]).abilities);
});
test("否定交付描述和纯岗位 / 学历名词不产生对应能力", () => {
  const material = sampleMaterial(
    "project",
    "否定样例",
    "我未开发否定样例，未负责系统上线；软件开发工程师，设计师，研究生。",
    fullProjectValues,
  );
  assert.ok(abilityDimensions.every(({ key }) => scoreMaterials([material]).abilities[key].score === null));
  const fromResume = extractMaterialsByRules("项目：否定交付项目，尚未上线，未部署，未验证。 ").materials;
  const enriched = enrichMaterialFacts(fromResume, { items: [], notes: [] });
  assert.equal(enriched[0].factor_observations.delivery, undefined);
});
test("错误年份的官方统计不填入目标届次，标识符不接受任意年份词", () => {
  const { input, batch } = awardResearch("3%");
  (batch.items[0].report!.year_data as Record<string, unknown>).participants = "2023 年有效参赛 1200 队";
  assert.equal(enrichMaterialFacts([input], batch)[0].factor_observations.participants, undefined);
  const claim = "2024 论文合成方法，DOI 10.9999/example。";
  const extracted = normalizeMaterialExtraction(
    {
      items: [
        {
          material_type: "research",
          title: "论文合成方法",
          year: 2024,
          identifiers: ["2024"],
          resume_claim: claim,
        },
      ],
    },
    claim,
  );
  assert.deepEqual(extracted.materials[0].identifiers, ["10.9999/example"]);
});
test("参赛数量 2000 不误判成年份，DOI 后缀 v2 不当作 arXiv 版本删除", () => {
  const { input, batch } = awardResearch("3%");
  (batch.items[0].report!.year_data as Record<string, unknown>).participants = "有效参赛 2000 队";
  assert.equal(enrichMaterialFacts([input], batch)[0].factor_observations.participants.value, 2000);
  const claim = "2024 论文合成版本，DOI 10.9999/examplev2，arXiv: 2401.00001v3。";
  const extracted = normalizeMaterialExtraction(
    {
      items: [
        {
          material_type: "research",
          title: "论文合成版本",
          identifiers: ["10.9999/examplev2", "arXiv: 2401.00001v3"],
          resume_claim: claim,
        },
      ],
    },
    claim,
  );
  assert.deepEqual(extracted.materials[0].identifiers.sort(), ["10.9999/examplev2", "arxiv:2401.00001"]);
});
