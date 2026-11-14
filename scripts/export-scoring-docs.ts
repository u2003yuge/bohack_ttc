import { mkdir, writeFile } from "node:fs/promises";
import {
  abilityDimensions,
  actionLevels,
  actionFloor,
  awardEventWeights,
  awardSelectivityReference,
  awardTierMultipliers,
  calibrationStatus,
  decayRatio,
  decayRatios,
  factorDefinitions,
  jobPresets,
  materialTypeLabels,
  scoreMaterials,
  scoringVersion,
  typeAdaptation,
  type MaterialType,
} from "../shared/material-scoring.js";
import { scoringSamples } from "../shared/scoring-samples.js";

const directory = new URL("../docs/", import.meta.url);
await mkdir(directory, { recursive: true });
const doc = [
  "# 简历材料评分 v1 实现与参数",
  "",
  `规则版本：\`${scoringVersion}\`。状态：${calibrationStatus}。`,
  "",
  "所有参数均已落地在 `shared/material-scoring.ts`，本文件由 `npx tsx scripts/export-scoring-docs.ts` 生成。它们是可复算的初版产品假设，不是经过双人标注或招聘结果验证的统计估计。30 条合成标注种子和待人工填写的表格用于下一轮校准。",
  "",
  "## 计算约定",
  "",
  "- 材料分 M = Σ(λ × g(事实))；各类型 λ 合计 1。分数为非负积分，可以超过 100；没有 100 分截断。",
  "- 未知因素保持 null，已知贡献形成暂定材料分；全部未知时 M=null。覆盖率 = 已知因素权重 / 总因素权重，不按覆盖率放大暂定分。",
  "- 有效参赛规模采用 g(n)=8×ln(1+n)，必须有单位和有效参赛口径；官方目标奖项比例采用 g(p)=18×(-ln p)，只接受官方已发布且 0<p≤1 的比例，绝不自行用获奖数/参赛数计算。",
  "- 奖项层级只解释目标赛事内部位置；规模、比例和赛制共同提供上下文。奖金、年龄、学校/公司名气不加分。期刊指标、作者顺序、引用量和 Star 数不直接作为个人能力代理。",
  "- 因素档位通过原文/报告字段中的固定规则匹配。模型只提取材料、个人行动和原文，不能输出材料积分、能力分或系数。未命中明确规则时保持 NA。",
  `- 每项能力贡献 D=M×R×A；候选人材料没有直接行动证据时使用最低归因系数 ${actionFloor} 并标记为暂定，资料库背景条目不生成个人贡献。公开团队成果或岗位职责不能自动成为直接行动证据。来源状态不与积分相乘。`,
  `- 每个能力维度内按材料父类型分组，按 D 降序，以材料类型对应的 ρ_t 递减；当前配置为 ${JSON.stringify(decayRatios)}。P=Σ类型Σ排名ρ_t^(排名−1)×D。一个维度没有任何有效贡献时 P=null。`,
  "- 材料类型摘要按 M 排序递减，仅作经历积累展示，不参与能力排序。相同输入与规则会产生相同分数。",
  "- 未映射材料不静默填零。能力已有支持时显示已知贡献小计和暂定标签，仍列出缺口；所需维度完全为 NA 时不生成可比岗位总分。",
  "",
  "## 材料因素与权重",
  "",
  "奖项更重视官方选择性与评审，研究更重视方法和实验，项目更重视问题与约束，工作更重视交付与影响，专利更重视技术和权利要求，开源更重视工程质量与实际贡献，证书更重视考核与实践。工作任务与岗位的相关性放在岗位偏好层处理，改变岗位不会重算基础材料分。",
  "",
];
for (const [type, factors] of Object.entries(factorDefinitions)) {
  doc.push(
    `### ${materialTypeLabels[type as MaterialType]}`,
    "",
    "| 因素 | 权重 λ | 积分函数或档位 |",
    "| --- | --- | --- |",
  );
  for (const f of factors)
    doc.push(
      `| ${f.label} | ${Math.round(f.weight * 100)}% | ${type === "award" && f.key === "participants" ? "Q：8 × ln(1 + 有效参赛规模)" : type === "award" && f.key === "judging" ? "Q：赛制与评审档位" : type === "award" && f.key === "award_rate" ? `P 选择性系数：min(1, -ln(p) / -ln(${awardSelectivityReference}))` : type === "award" && f.key === "tier" ? `P 层级系数：${JSON.stringify(awardTierMultipliers)}` : f.kind === "size" ? "8 × ln(1 + 有效参赛规模)" : f.kind === "selectivity" ? "18 × -ln(官方目标奖项比例)" : f.choices.map((c) => `${c.label}：${c.points}`).join("；")} |`,
    );
  doc.push("");
}
doc.push(
  "## 类型适配矩阵 R",
  "",
  "这是材料类型通常能支持某能力的先验，不是对人物的评级。高值给直接专业任务，证书和间接成果的映射较保守；仍必须有对应维度的个人行动。",
  "",
  `| 类型 | ${abilityDimensions.map((d) => d.label).join(" | ")} |`,
  "| --- | --- | --- | --- | --- | --- |",
);
for (const [type, values] of Object.entries(typeAdaptation))
  doc.push(
    `| ${materialTypeLabels[type as MaterialType]} | ${abilityDimensions.map(({ key }) => values[key]).join(" | ")} |`,
  );
doc.push(
  "",
  "## 个人行动系数 A",
  "",
  "| 档位 | 系数 | 条件 |",
  "| --- | --- | --- |",
  `| guided | 维度专属 | 在指导下或协助完成明确动作与对象 |`,
  `| concrete | 维度专属 | 有具体动作和对象 |`,
  `| owned | 维度专属 | 明确承担该行动的责任 |`,
  `| validated | 维度专属 | 明确承担责任，且有交付、测试通过或验证结果 |`,
  "专业执行 / 问题解决：0.20、0.45、0.70、0.90；责任交付 / 协作组织：0.25、0.50、0.75、0.95；学习研究：0.20、0.45、0.70、0.90。",
  `| floor | ${actionFloor} | 没有直接行动证据时使用最低归因系数，结果标记为暂定 |`,
  "| NA | null | 资料库背景条目没有候选人个人贡献 |",
  "",
  "同一材料同一维度取最高一个有效行动档位，不叠加措辞数量。每次保存命中规则、理由和原文。否定描述、团队/他人动作和公开岗位职责不自动生成本人贡献。",
  "",
  "## 岗位预设 q",
  "",
  `| 岗位 | ${abilityDimensions.map((d) => d.label).join(" | ")} |`,
  "| --- | --- | --- | --- | --- | --- |",
);
for (const preset of jobPresets)
  doc.push(`| ${preset.title} | ${preset.values.map((v) => `${v * 100}%`).join(" | ")} |`);
doc.push(
  "",
  "岗位排序分=Σ(q×P)。没有岗位名称时不生成总分。权重非负并归一化；自然语言请求只发送岗位偏好及当前配置，不发送候选人。草案预览权重、分数和排名变化，采用后才生效。必备条件分别标为支持、否定、未知或冲突；缺失不视为不符合，复杂年限要求暂留待核实。存在所需 NA、条件未知或冲突时不混入可比总分排名。暂定分保留证据缺口。不同评分版本或不同递减参数不混排。",
  "",
  "## 去重、版本与证据",
  "",
  "- 同一材料的重复抽取/报道合并来源；不同年份的独立奖项、新交付阶段保留，同名不同机构不合并。",
  "- DOI / arXiv 等确认的标识符关联论文版本；不能确认同一成果时不凭标题近似合并。已发表状态可替代预印本状态，不重复加分。",
  "- 相同因素出现数值或档位来源冲突时保持 NA，后来的重复记录不会把争议因素补回；确认是同一论文的状态推进可升级为正式发表状态。",
  "- 三类 Skill 六块 JSON 保持原格式；评分适配层记录报告字段路径和来源，不向 Skill 强加评分字段。",
  "- 私有候选人材料、个人行动及评估历史在 RESUME_DIR/.metadata 中；公共背景报告仍在 db/。画像保存输入、规则、来源报告快照、SHA-256 输入指纹和评估时间。",
  "- 新评估只写 assessment / assessmentHistory，旧 scoreCard / scoreHistory 原样保留，旧百分位和旧六维分数不与 v1 混排。",
  "- 复评记录说明评估结果变化，不能仅因时间经过或材料数量增加就称为成长。",
  "",
  "## 原细则示例的修正",
  "",
  "竞赛贡献 10 与项目贡献 60 属于不同父类型，分别从递减权重 1 开始，合计 70。同父类型两项贡献为 60、10 时才是 60+0.5×10=65。实现遵循正文的分组聚合公式。",
  "",
  "## 接口与运行",
  "",
  "- GET /api/scoring/rules：读取当前规则、矩阵和预设。",
  "- POST /api/scoring/evaluate：评估 text，可指定 useModel=false、includeResearch=false，无模型配置也可使用保守规则抽取。",
  "- POST /api/resumes/:id/assessment：评估并保存 PDF 候选人，ocrText 只替代本次输入。",
  "- POST /api/resumes/:id/analyze：先评估材料并复用同一批研究资料，再让模型解释已计算结果。",
  "- GET /api/scoring/jobs、PUT /api/scoring/jobs：本地岗位配置。",
  "- POST /api/scoring/preferences/draft：自然语言偏好草案，有模型时用模型、不可用时用固定解析规则。",
  "- 流式接口发送 progress、research、assessment、answer、complete、error、heartbeat；只有 complete 对应成功保存。取消请求不追加评估历史。",
  "",
  "## 校准与验证",
  "",
  "`shared/scoring-samples.ts` 含 30 条合成材料；`docs/SCORING_ANNOTATIONS.csv` 提供因素、材料分、五维派生结果和两位评审的空白栏。自动导出不会覆盖已经存在的人工标注表。表内初始积分只表示当前规则的计算结果，不冒充人工校准。核心测试覆盖重复、缺失、团队归因、按贡献排序、跨类型递减、参数变化、来源冲突、中英文、岗位独立和历史版本隔离。",
  "",
);
await writeFile(new URL("SCORING_V1.md", directory), doc.join("\n"), "utf8");
const csv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const headers = [
  "样例ID",
  "场景",
  "类型",
  "标题",
  "年份",
  "合成原文",
  "因素初始标注建议",
  "初始规则材料分",
  "因素覆盖率",
  ...abilityDimensions.map((d) => d.label),
  "个人行动档位",
  "证据状态",
  "评审A意见",
  "评审B意见",
  "校准结论",
];
const rows = scoringSamples.map(({ id, scenario, material }) => {
  const scored = scoreMaterials([material]);
  return [
    id,
    scenario,
    material.material_type,
    material.title,
    material.year,
    material.resume_claim,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(material.factor_observations).map(([key, item]) => [key, item.value]),
      ),
    ),
    scored.materials[0].material_score ?? "NA",
    scored.materials[0].score_coverage,
    ...abilityDimensions.map(({ key }) => scored.abilities[key].score ?? "NA"),
    JSON.stringify(
      Object.fromEntries(
        abilityDimensions.map(({ key }) => [key, scored.materials[0].dimension_mapping[key].rule]),
      ),
    ),
    material.evidence_states.join("、"),
    "",
    "",
    "待双人复核",
  ];
});
try {
  await writeFile(
    new URL("SCORING_ANNOTATIONS.csv", directory),
    "\uFEFF" + [headers, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n",
    { encoding: "utf8", flag: "wx" },
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
console.log("Exported scoring rules; annotation sheets are preserved if already present.");
