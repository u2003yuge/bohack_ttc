import {
  materialIdentity,
  stableMaterialId,
  type Evidence,
  type FactorObservation,
  type MaterialInput,
  type MaterialType,
} from "./material-scoring.js";

/** Synthetic annotation seeds, not human-labelled hiring outcomes. */
export function sampleMaterial(
  type: MaterialType,
  title: string,
  claim: string,
  values: Record<string, string | number> = {},
  year = 2024,
): MaterialInput {
  if (!claim.includes(title)) claim = `${title}：${claim}`;
  const evidence: Evidence = { origin: "resume", quote: claim, source: "合成标注样例原文" };
  const input: MaterialInput = {
    material_id: "",
    material_type: type,
    title,
    year,
    organization: "合成团队",
    stage: null,
    result: type === "award" ? "一等奖" : null,
    identifiers: [],
    resume_claim: claim,
    personal_action_evidence: [evidence],
    sources: [evidence],
    external_facts: { synthetic: true },
    factor_observations: Object.fromEntries(
      Object.entries(values).map(([key, value]): [string, FactorObservation] => [
        key,
        { value, evidence, official: key === "award_rate" },
      ]),
    ),
    notes: ["合成验收材料，因素档位为待双人复核的初始标注建议。"],
    evidence_states: ["简历自述"],
  };
  input.material_id = stableMaterialId(materialIdentity(input));
  return input;
}
export const fullProjectValues = {
  complexity: "advanced",
  constraints: "multiple",
  delivery: "accepted",
  adoption: "wide",
  outcome: "measured",
};
export const ordinaryProjectValues = {
  complexity: "bounded",
  constraints: "bounded",
  delivery: "tested",
  adoption: "pilot",
  outcome: "delivered",
};
export const completeAction =
  "我独立负责开发分布式系统核心模块，处理高并发与一致性约束，比较方案并验证瓶颈，协调跨团队拆解任务，学习新技术并开展对照实验，完成生产环境上线与验收交付，被多个部门实际使用，响应时间降低 40%。";
export const scoringSamples: Array<{ id: string; scenario: string; material: MaterialInput }> = [
  {
    id: "S01",
    scenario: "高质量奖项与多项普通奖项比较",
    material: sampleMaterial(
      "award",
      "合成算法挑战赛",
      "2024 合成算法挑战赛一等奖；我负责开发求解器并完成交付。",
      { participants: 100000, award_rate: 0.001, tier: "first", judging: "reproducible" },
    ),
  },
  {
    id: "S02",
    scenario: "普通奖项",
    material: sampleMaterial("award", "合成校内赛", "2024 合成校内赛三等奖；我开发排序程序。", {
      tier: "third",
      judging: "specified",
    }),
  },
  {
    id: "S03",
    scenario: "团队获奖但无个人分工",
    material: sampleMaterial("award", "合成团队赛", "2024 合成团队赛一等奖，团队共六人。", {
      tier: "first",
      judging: "rubric",
    }),
  },
  {
    id: "S04",
    scenario: "同一奖项重复展示",
    material: sampleMaterial(
      "award",
      "合成算法挑战赛",
      "2024 合成算法挑战赛一等奖；我负责开发求解器并完成交付。",
      { participants: 100000, award_rate: 0.001, tier: "first", judging: "reproducible" },
    ),
  },
  {
    id: "S05",
    scenario: "同赛事不同年份独立获奖",
    material: sampleMaterial(
      "award",
      "合成算法挑战赛",
      "2025 合成算法挑战赛一等奖；我负责开发新的求解器。",
      { tier: "first" },
      2025,
    ),
  },
  {
    id: "S06",
    scenario: "缺少官方比例，不能推算",
    material: sampleMaterial(
      "award",
      "合成统计赛",
      "2024 合成统计赛一等奖；有效参赛一千队，获奖三十队，未公布获奖比例。",
      { tier: "first" },
    ),
  },
  {
    id: "S07",
    scenario: "预印本状态",
    material: {
      ...sampleMaterial(
        "research",
        "Synthetic attention method",
        "2023 Synthetic attention method，DOI 10.9999/synthetic-1，预印本。",
        { status: "preprint" },
        2023,
      ),
      identifiers: ["10.9999/synthetic-1"],
    },
  },
  {
    id: "S08",
    scenario: "同一论文会议版",
    material: {
      ...sampleMaterial(
        "research",
        "Synthetic attention method",
        "2024 Synthetic attention method，DOI 10.9999/synthetic-1，正式发表。",
        { status: "published" },
      ),
      identifiers: ["10.9999/synthetic-1"],
    },
  },
  {
    id: "S09",
    scenario: "同一论文期刊版",
    material: {
      ...sampleMaterial(
        "research",
        "Synthetic attention method",
        "2025 Synthetic attention method，DOI 10.9999/synthetic-1，期刊版。",
        { status: "published" },
        2025,
      ),
      identifiers: ["10.9999/synthetic-1"],
    },
  },
  {
    id: "S10",
    scenario: "明确个人研究行动",
    material: sampleMaterial(
      "research",
      "合成对照实验研究",
      "我负责设计合成对照实验研究，比较基线并开展消融实验，完成公开代码和实验报告。",
      {
        question: "complex",
        rigor: "validated",
        experiments: "robust",
        reproducibility: "available",
        status: "published",
        content: "delivered",
      },
    ),
  },
  {
    id: "S11",
    scenario: "完整五维个人行动",
    material: sampleMaterial("project", "合成分布式项目", completeAction, fullProjectValues),
  },
  {
    id: "S12",
    scenario: "普通项目明确个人贡献",
    material: sampleMaterial(
      "project",
      "合成借还模块",
      "我负责设计借还模块，完成上线并交付测试报告。",
      ordinaryProjectValues,
    ),
  },
  {
    id: "S13",
    scenario: "高材料分但只参与",
    material: sampleMaterial(
      "project",
      "合成大型平台",
      "参与合成大型平台项目，团队完成生产部署。",
      fullProjectValues,
    ),
  },
  {
    id: "S14",
    scenario: "高材料分但仅协助开发",
    material: sampleMaterial(
      "project",
      "合成复杂模块",
      "我在指导下协助开发合成复杂模块。",
      fullProjectValues,
    ),
  },
  {
    id: "S15",
    scenario: "同名项目不同机构",
    material: {
      ...sampleMaterial(
        "project",
        "合成借还模块",
        "我负责设计借还模块，完成上线并交付测试报告。",
        ordinaryProjectValues,
      ),
      organization: "另一个合成实验室",
    },
  },
  {
    id: "S16",
    scenario: "跨年项目独立新交付",
    material: {
      ...sampleMaterial(
        "project",
        "合成借还模块",
        "2025 我负责开发新的维修模块并完成交付。",
        ordinaryProjectValues,
        2025,
      ),
      stage: "维修模块独立交付",
    },
  },
  {
    id: "S17",
    scenario: "工作经历明确任务与结果",
    material: sampleMaterial(
      "work",
      "合成支付任务",
      "我独立负责支付订单服务，定位瓶颈并验证优化方案，完成生产交付，延迟降低 30%。",
      { complexity: "complex", scope: "owned", delivery: "accepted", impact: "measured" },
    ),
  },
  {
    id: "S18",
    scenario: "只有岗位头衔",
    material: sampleMaterial("work", "合成负责人", "2024 合成公司高级负责人，团队二十人。"),
  },
  {
    id: "S19",
    scenario: "明确跨团队协作",
    material: sampleMaterial("work", "合成协调任务", "我协调产品与测试团队拆解需求，负责推进验收交付。", {
      scope: "owned",
      delivery: "accepted",
      impact: "delivered",
    }),
  },
  {
    id: "S20",
    scenario: "混排英文行动",
    material: sampleMaterial(
      "work",
      "Synthetic API service",
      "I independently developed Synthetic API service, analyzed latency and delivered production changes, reduced latency 30%.",
      { complexity: "bounded", scope: "owned", delivery: "accepted", impact: "measured" },
    ),
  },
  {
    id: "S21",
    scenario: "授权专利但无个人行动",
    material: sampleMaterial("patent", "合成调度专利", "2024 合成调度专利已授权，公开权利要求。", {
      status: "granted",
      technical: "complex",
      claims: "specific",
    }),
  },
  {
    id: "S22",
    scenario: "专利技术实现与验证",
    material: sampleMaterial(
      "patent",
      "合成控制专利",
      "我负责设计合成控制专利技术方案，比较算法并完成验证。",
      { status: "published", technical: "complex", claims: "validated", application: "pilot" },
    ),
  },
  {
    id: "S23",
    scenario: "专利信息不足",
    material: sampleMaterial("patent", "合成未知专利", "2024 提及合成未知专利，未提供公开或授权记录。"),
  },
  {
    id: "S24",
    scenario: "开源具体贡献与维护",
    material: sampleMaterial(
      "opensource",
      "合成开源工具",
      "我独立负责合成开源工具核心模块，编写单元测试并持续维护，完成版本发布。",
      {
        runnable: "released",
        quality: "tested",
        maintenance: "sustained",
        contribution: "core",
        adoption: "demo",
      },
    ),
  },
  {
    id: "S25",
    scenario: "Star 数不自动代表质量",
    material: sampleMaterial(
      "opensource",
      "合成热门仓库",
      "合成热门仓库获得十万 Star，未提供代码或个人贡献。",
    ),
  },
  {
    id: "S26",
    scenario: "开源文档与测试贡献",
    material: sampleMaterial("opensource", "合成测试工具", "我编写合成测试工具文档，开发并测试接口样例。", {
      runnable: "tested",
      quality: "documented",
      maintenance: "changes",
      contribution: "implemented",
    }),
  },
  {
    id: "S27",
    scenario: "证书考试与实践",
    material: sampleMaterial(
      "certificate",
      "合成工程认证",
      "我通过合成工程认证实操考核，独立开发系统原型并完成测试。",
      { assessment: "practical", practice: "tested", curriculum: "specific" },
    ),
  },
  {
    id: "S28",
    scenario: "课程学习行动",
    material: sampleMaterial(
      "certificate",
      "合成高级课程",
      "我学习合成高级课程，开展算法实验并编写实验报告。",
      { assessment: "coursework", practice: "designed", curriculum: "advanced" },
    ),
  },
  {
    id: "S29",
    scenario: "证书只有名称",
    material: sampleMaterial("certificate", "合成未知证书", "2024 获得合成未知证书，未说明考核方式。"),
  },
  {
    id: "S30",
    scenario: "来源冲突保留未知",
    material: {
      ...sampleMaterial("award", "合成冲突赛事", "2024 合成冲突赛事一等奖，获奖比例两处来源不一致。", {
        tier: "first",
      }),
      evidence_states: ["简历自述", "冲突/未能消歧"],
      notes: ["官方比例来源冲突，比例因素保持 NA。"],
    },
  },
];
