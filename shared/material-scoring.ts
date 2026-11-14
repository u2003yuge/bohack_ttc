/** Versioned, deterministic scoring. Models may extract facts; they never supply points. */
export const scoringVersion = "material-derived-v1.4.0";
export const calibrationStatus = "v1.4 赛事质量与表现分离、行动系数设最低归因值，待双人标注校准";
export const decayRatio = 0.55;
export const decayRatios: Record<MaterialType, number> = { award: 0.45, research: 0.6, project: 0.55, work: 0.7, patent: 0.55, opensource: 0.6, certificate: 0.45 };
export const awardEventWeights = { participants: 0.5, judging: 0.5 } as const;
export const awardTierMultipliers = { top: 1, first: 0.85, second: 0.65, third: 0.45, finalist: 0.25 } as const;
export const awardSelectivityReference = 0.001;
export const abilityDimensions = [
  { key: "professional_execution", label: "专业执行" },
  { key: "problem_solving", label: "问题解决" },
  { key: "ownership_delivery", label: "责任与交付" },
  { key: "collaboration_organization", label: "协作与组织" },
  { key: "learning_research", label: "学习与研究" },
] as const;
export type AbilityKey = (typeof abilityDimensions)[number]["key"];
export const materialTypeLabels = {
  award: "奖项 / 竞赛",
  research: "论文 / 研究",
  project: "项目",
  work: "工作 / 实习",
  patent: "专利",
  opensource: "开源作品",
  certificate: "证书 / 课程",
} as const;
export type MaterialType = keyof typeof materialTypeLabels;
export type EvidenceState =
  "简历自述" | "背景已核实" | "个人材料支持" | "独立来源支持个人贡献" | "资料库背景" | "冲突/未能消歧";
export type Evidence = {
  origin: "resume" | "research";
  quote: string;
  source: string;
  path?: string;
  url?: string | null;
};
export type FactorObservation = { value: number | string; evidence: Evidence; official?: boolean };
export type FactorDefinition = {
  key: string;
  label: string;
  weight: number;
  kind?: "size" | "selectivity";
  choices: Array<{ key: string; label: string; points: number; pattern: string }>;
};
const choice = (key: string, label: string, points: number, pattern: string) => ({
  key,
  label,
  points,
  pattern,
});
const factor = (
  key: string,
  label: string,
  weight: number,
  choices: FactorDefinition["choices"],
): FactorDefinition => ({ key, label, weight, choices });
const complexity = [
  choice(
    "advanced",
    "多重约束或跨系统复杂问题",
    120,
    "分布式|跨系统|高并发|容灾|多目标|多模态|distributed|fault.toleran|multi.objective",
  ),
  choice(
    "complex",
    "明确的系统或方法复杂度",
    80,
    "系统|平台|架构|算法|复杂|system|platform|architecture|algorithm",
  ),
  choice("bounded", "明确的模块或任务", 45, "模块|接口|流程|实验|module|interface|workflow|experiment"),
  choice("basic", "有明确对象的基础实现", 20, "脚本|页面|表单|script|page|form"),
];
const delivery = [
  choice(
    "accepted",
    "验收或持续生产交付",
    120,
    "验收|生产环境|持续运行|正式交付|production|accepted delivery",
  ),
  choice("released", "已上线或部署", 80, "上线|部署|发布|交付|deployed|released|delivered"),
  choice("tested", "完成测试或可运行原型", 45, "测试通过|原型|试点|prototype|pilot|tested"),
  choice("designed", "形成明确方案或设计", 20, "设计方案|技术方案|需求分析|design document|proposal"),
];
const outcome = [
  choice(
    "measured",
    "有明确指标与比较结果",
    120,
    "(?:提升|降低|减少|缩短|增长|improv|reduc|increase).{0,45}\\d+(?:\\.\\d+)?\\s*(?:%|倍|秒|天|ms)|(?:从|from).{0,30}(?:到|至|to).{0,15}\\d",
  ),
  choice("adopted", "有实际采用或验收结果", 80, "验收|正式采用|实际使用|投产|adopted|in use|production"),
  choice("delivered", "有明确交付成果", 45, "交付|完成|实现|delivered|completed|implemented"),
  choice("documented", "形成可检查的文档或作品", 20, "报告|文档|作品|report|documentation|artifact"),
];
const adoption = [
  choice(
    "wide",
    "有多单位或公开采用证据",
    120,
    "多家|多个部门|跨部门|企业客户|多所|multiple (?:organizations|teams)|enterprise customers",
  ),
  choice("production", "实际部署或应用", 80, "实际使用|投产|生产环境|上线|production|deployed"),
  choice("pilot", "试点或测试使用", 45, "试点|试用|pilot|trial"),
  choice("demo", "可访问或演示", 20, "演示|可访问|demo|accessible"),
];
export const factorDefinitions: Record<MaterialType, FactorDefinition[]> = {
  award: [
    { key: "participants", label: "有效参赛规模", weight: awardEventWeights.participants, kind: "size", choices: [] },
    { key: "award_rate", label: "官方目标奖项比例（表现比例）", weight: 0, kind: "selectivity", choices: [] },
    factor("tier", "本赛事奖项层级（表现比例）", 0, [
      choice("top", "本赛事最高奖", 100, "特等奖|冠军|金奖|金牌|grand prize|champion|gold"),
      choice("first", "一等奖 / 一等层级", 75, "一等奖|first prize"),
      choice("second", "二等奖 / 银奖", 50, "二等奖|银奖|银牌|second prize|silver"),
      choice("third", "三等奖 / 铜奖", 30, "三等奖|铜奖|铜牌|third prize|bronze"),
      choice("finalist", "有明确结果的入围或优胜", 15, "入围|优胜|finalist|honorable mention"),
    ]),
    factor("judging", "赛制与评审规则", awardEventWeights.judging, [
      choice(
        "reproducible",
        "可复核测试 / 盲评和答辩",
        100,
        "隐藏测试|测试用例|盲评|匿名评审|复现|hidden test|test cases|blind review",
      ),
      choice(
        "rubric",
        "明确评分规则和专家评审",
        75,
        "评分标准|评审标准|专家评审|scoring rubric|judging criteria",
      ),
      choice("specified", "有明确赛制或评审方式", 45, "限时|答辩|评审|比赛规则|timed|judged|defense"),
    ]),
  ],
  research: [
    factor("question", "研究问题", 0.15, complexity),
    factor("rigor", "方法严谨度", 0.25, [
      choice(
        "validated",
        "对照、消融及统计验证",
        100,
        "消融|统计显著|置信区间|ablation|statistical significance|confidence interval",
      ),
      choice("controlled", "对照或基线实验", 75, "对照|基线|baseline|controlled experiment"),
      choice("method", "明确研究方法", 45, "实验方法|研究方法|提出.{0,20}方法|methodology|proposed method"),
    ]),
    factor("experiments", "实验质量", 0.2, [
      choice(
        "robust",
        "多数据集、误差或鲁棒性分析",
        100,
        "多数据集|误差分析|鲁棒性|多次实验|multiple datasets|error analysis|robustness",
      ),
      choice("comparison", "明确实验比较", 75, "对比实验|基线|baseline|comparative experiment"),
      choice("specified", "有实验设置", 45, "实验设置|实验结果|experimental setup|experimental results"),
    ]),
    factor("reproducibility", "可复现性", 0.15, [
      choice("reproduced", "明确的独立复现记录", 100, "独立复现成功|第三方复现|independently reproduced"),
      choice(
        "complete",
        "代码、数据和运行说明齐全",
        75,
        "代码.{0,25}数据.{0,25}(?:说明|脚本)|code.{0,25}data.{0,25}(?:instructions|scripts)",
      ),
      choice(
        "available",
        "提供开放材料",
        40,
        "公开代码|开源代码|代码仓库|数据集链接|code repository|open.source code",
      ),
    ]),
    factor("status", "成果状态", 0.1, [
      choice("published", "已正式发表", 80, "已发表|正式发表|已在线发表|published|online publication"),
      choice("accepted", "已录用未发表", 55, "已录用|accepted"),
      choice("preprint", "预印本", 20, "预印本|preprint|arxiv"),
    ]),
    factor("content", "研究内容与验证结果", 0.15, outcome),
  ],
  project: [
    factor("complexity", "问题复杂度", 0.25, complexity),
    factor("constraints", "技术 / 业务约束", 0.2, [
      choice(
        "multiple",
        "多重约束与权衡",
        100,
        "高并发|容灾|一致性|跨系统|隐私|合规|trade.off|fault.toleran|consistency",
      ),
      choice(
        "explicit",
        "明确性能或业务约束",
        75,
        "延迟|性能|吞吐|成本|兼容|latency|performance|budget|compatibility",
      ),
      choice("bounded", "明确任务边界", 40, "需求|约束|任务|requirement|constraint|task"),
    ]),
    factor("delivery", "交付阶段", 0.2, delivery),
    factor("adoption", "部署 / 采用", 0.15, adoption),
    factor("outcome", "结果质量", 0.2, outcome),
  ],
  work: [
    factor("complexity", "任务复杂度", 0.2, complexity),
    factor("scope", "具体责任范围", 0.25, [
      choice("end_to_end", "明确的端到端责任", 100, "端到端|从需求.{0,30}(?:上线|交付)|end.to.end"),
      choice(
        "owned",
        "独立负责具体范围",
        75,
        "独立负责|负责.{2,45}(?:模块|服务|项目|流程)|owned|responsible for",
      ),
      choice("specific", "明确执行任务", 40, "开发|设计|测试|分析|implemented|developed|tested|analyzed"),
    ]),
    factor("delivery", "实际交付", 0.25, delivery),
    factor("impact", "结果影响", 0.3, outcome),
  ],
  patent: [
    factor("status", "公开 / 授权状态", 0.2, [
      choice("granted", "已授权", 80, "已授权|授权公告|granted"),
      choice("published", "已公开", 45, "已公开|公开公告|published application"),
      choice("filed", "有申请记录", 20, "申请号|已申请|application number|filed"),
    ]),
    factor("technical", "技术问题与方法", 0.35, complexity),
    factor("claims", "权利要求", 0.25, [
      choice(
        "validated",
        "明确权利要求及实现验证",
        100,
        "权利要求.{0,45}(?:验证|实现|测试)|claims.{0,45}(?:validated|implemented)",
      ),
      choice("specific", "有具体权利要求", 70, "权利要求|patent claims"),
      choice("description", "有技术方案说明", 30, "技术方案|technical solution"),
    ]),
    factor("application", "应用情况", 0.2, adoption),
  ],
  opensource: [
    factor("runnable", "可运行性", 0.2, delivery),
    factor("quality", "代码质量", 0.25, [
      choice(
        "engineering",
        "测试、CI 与接口文档",
        100,
        "(?:测试|test).{0,45}(?:CI|持续集成).{0,45}(?:文档|doc)|持续集成.{0,45}测试",
      ),
      choice(
        "tested",
        "自动测试或持续集成",
        75,
        "单元测试|集成测试|持续集成|unit test|integration test|CI/CD",
      ),
      choice("documented", "有使用说明", 40, "README|使用说明|接口文档|documentation"),
    ]),
    factor("maintenance", "维护持续性", 0.15, [
      choice(
        "sustained",
        "持续发布并处理问题",
        100,
        "持续维护|定期发布|持续发布|sustained maintenance|regular releases",
      ),
      choice("responded", "有问题处理或版本维护", 70, "修复|版本发布|issue|bug fix|release"),
      choice("changes", "有可定位提交", 30, "提交|pull request|commit"),
    ]),
    factor("contribution", "具体贡献", 0.2, [
      choice("core", "核心功能与维护责任", 100, "维护者|核心模块|核心功能|maintainer|core module"),
      choice(
        "implemented",
        "明确的代码或文档贡献",
        70,
        "实现|开发|修复|编写|implemented|developed|fixed|authored",
      ),
      choice("reviewed", "明确评审或测试贡献", 30, "代码评审|测试|code review|tested"),
    ]),
    factor("adoption", "使用 / 采用", 0.2, adoption),
  ],
  certificate: [
    factor("assessment", "考核方式", 0.45, [
      choice("practical", "实操考核", 100, "实操考核|实验考核|practical exam|hands.on assessment"),
      choice("exam", "明确考试", 70, "通过考试|认证考试|passed.{0,20}exam|certification exam"),
      choice("coursework", "课程考核", 30, "课程作业|结课考核|coursework|course assessment"),
    ]),
    factor("practice", "实际练习与作品", 0.35, delivery),
    factor("curriculum", "课程内容深度", 0.2, [
      choice("advanced", "有明确高级专题", 100, "高级|进阶|专题|advanced|specialized"),
      choice(
        "specific",
        "有明确方法与实践内容",
        60,
        "实验|项目|算法|系统|experiment|project|algorithm|system",
      ),
      choice("foundation", "基础课程内容", 25, "基础|入门|foundation|introductory"),
    ]),
  ],
};
export const typeAdaptation: Record<MaterialType, Record<AbilityKey, number>> = Object.fromEntries(
  Object.entries({
    award: [0.65, 0.7, 0.45, 0.35, 0.55],
    research: [0.7, 0.9, 0.6, 0.35, 1],
    project: [1, 1, 0.95, 0.75, 0.65],
    work: [1, 0.85, 1, 0.8, 0.6],
    patent: [0.6, 0.85, 0.5, 0.3, 0.8],
    opensource: [1, 0.85, 0.85, 0.6, 0.7],
    certificate: [0.45, 0.4, 0.25, 0.15, 0.7],
  }).map(([type, values]) => [
    type,
    Object.fromEntries(abilityDimensions.map(({ key }, i) => [key, values[i]])),
  ]),
) as Record<MaterialType, Record<AbilityKey, number>>;
export const actionLevels = { guided: 0.25, concrete: 0.5, owned: 0.75, validated: 1 } as const;
export const actionFloor = 0.1;
export const actionCoefficients: Record<AbilityKey, Record<keyof typeof actionLevels, number>> = { professional_execution: { guided: 0.2, concrete: 0.45, owned: 0.7, validated: 0.9 }, problem_solving: { guided: 0.2, concrete: 0.45, owned: 0.7, validated: 0.9 }, ownership_delivery: { guided: 0.25, concrete: 0.5, owned: 0.75, validated: 0.95 }, collaboration_organization: { guided: 0.25, concrete: 0.5, owned: 0.75, validated: 0.95 }, learning_research: { guided: 0.2, concrete: 0.45, owned: 0.7, validated: 0.9 } };
export type MaterialInput = {
  material_id: string;
  material_type: MaterialType;
  title: string;
  year: string | number | null;
  organization: string | null;
  stage: string | null;
  result: string | null;
  identifiers: string[];
  resume_claim: string;
  personal_action_evidence: Evidence[];
  sources: Evidence[];
  external_facts: Record<string, unknown>;
  factor_observations: Record<string, FactorObservation>;
  notes: string[];
  evidence_states: EvidenceState[];
};
export type FactorScore = {
  key: string;
  label: string;
  weight: number;
  value: string | number | null;
  points: number | null;
  contribution: number | null;
  evidence: Evidence | null;
  reason: string;
};
export type AbilityMapping = {
  mapping_coefficient: number | null;
  rule: keyof typeof actionLevels | null;
  mapping_reason: string;
  supporting_evidence: Evidence[];
  type_coefficient: number;
  derived_contribution: number | null;
};
export type ScoredMaterial = MaterialInput & {
  material_score: number | null;
  event_score: number | null;
  performance_ratio: number | null;
  performance_breakdown: {
    award_rate: number | null;
    selectivity_multiplier: number | null;
    tier_multiplier: number | null;
    reason: string;
  } | null;
  score_breakdown: FactorScore[];
  score_coverage: number;
  missing_factors: string[];
  provisional: boolean;
  dimension_mapping: Record<AbilityKey, AbilityMapping>;
  merged_from: string[];
};
export type ContributionTerm = {
  material_id: string;
  title: string;
  material_type: MaterialType;
  material_score: number;
  type_coefficient: number;
  mapping_coefficient: number;
  derived_contribution: number;
  rank: number;
  decay: number;
  contribution: number;
  evidence: Evidence[];
};
export type AbilityScore = {
  score: number | null;
  provisional: boolean;
  terms: ContributionTerm[];
  missing_materials: number;
};
export type Assessment = {
  id: string;
  version: typeof scoringVersion;
  evaluatedAt: string;
  inputHash: string;
  extraction: "model" | "rules";
  calibration: string;
  rho: number;
  rhoByType?: Record<MaterialType, number>;
  materials: ScoredMaterial[];
  abilities: Record<AbilityKey, AbilityScore>;
  type_summaries: Array<{ type: MaterialType; score: number | null; count: number }>;
  notes: string[];
  inputSnapshot: string;
  researchSnapshot: unknown;
  rulesSnapshot: unknown;
  materialContributions?: Record<string, Record<AbilityKey, number | null>>;
};
export type AssessmentHistoryEntry = { reason: "import" | "review"; assessment: Assessment };
export type LibraryMaterialScore = {
  knowledgeIds: string[];
  candidateId: string;
  candidateName: string;
  assessmentId: string;
  evaluatedAt: string;
  scoringVersion: string;
  materialId: string;
  materialType: MaterialType;
  materialTitle: string;
  year: string | number | null;
  resumeClaim: string;
  materialScore: number | null;
  eventScore: number | null;
  performanceRatio: number | null;
  performanceBreakdown: ScoredMaterial["performance_breakdown"];
  scoreCoverage: number;
  provisional: boolean;
  missingFactors: string[];
  scoreBreakdown: FactorScore[];
  sources: Evidence[];
  abilityContributions: Record<AbilityKey, {
    score: number | null;
    typeCoefficient: number;
    actionCoefficient: number | null;
    derivedContribution: number | null;
    typeRank: number | null;
    decay: number | null;
    contribution: number | null;
    reason: string;
    evidence: Evidence[];
  }>;
};
export const roundPoints = (value: number) => Math.round(value * 1e6) / 1e6;
/** Every material's contribution after sorting and same-type decay. */
export function withMaterialContributions(assessment: Assessment): Assessment {
  const materialContributions = Object.fromEntries(assessment.materials.map((material) => [
    material.material_id,
    Object.fromEntries(abilityDimensions.map(({ key }) => [
      key,
      assessment.abilities[key].terms.find((term) => term.material_id === material.material_id)?.contribution ?? null,
    ])) as Record<AbilityKey, number | null>,
  ]));
  return { ...assessment, materialContributions };
}
export const normalizeIdentity = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function stableMaterialId(value: string) {
  let first = 2166136261,
    second = 5381;
  for (const char of value) {
    first = Math.imul(first ^ char.codePointAt(0)!, 16777619);
    second = Math.imul(second, 33) ^ char.codePointAt(0)!;
  }
  return `m-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
export function materialIdentity(material: MaterialInput): string {
  const identifier = material.identifiers.map((value) => value.trim().toLowerCase()).sort()[0];
  if (material.material_type === "research" && identifier) return `research:${identifier}`;
  if (material.material_type === "research" && typeof material.external_facts.version_group === "string")
    return `research:versions:${material.external_facts.version_group}`;
  const title =
    typeof material.external_facts.canonical_title === "string"
      ? material.external_facts.canonical_title
      : material.title;
  return [
    material.material_type,
    normalizeIdentity(title),
    material.year ?? "NA",
    normalizeIdentity(material.organization ?? ""),
    normalizeIdentity(material.stage ?? ""),
    material.material_type === "award" ? normalizeIdentity(material.result ?? "") : "",
  ].join(":");
}
const uniqueEvidence = (items: Evidence[]) => [...new Map(items.map((e) => [JSON.stringify(e), e])).values()];
function deduplicate(inputs: MaterialInput[]): Array<MaterialInput & { merged_from: string[] }> {
  const parents = new Map<string, string>();
  const root = (key: string): string => {
    const parent = parents.get(key);
    if (!parent || parent === key) {
      parents.set(key, key);
      return key;
    }
    const found = root(parent);
    parents.set(key, found);
    return found;
  };
  for (const input of inputs) {
    const keys = [
      materialIdentity(input),
      ...(input.material_type === "research" ? input.identifiers.map((id) => `research:${id}`) : []),
    ];
    if (input.material_type === "research" && typeof input.external_facts.version_group === "string")
      keys.push(`research:versions:${input.external_facts.version_group}`);
    for (const key of keys) {
      const a = root(keys[0]),
        b = root(key);
      if (a !== b) parents.set(b, a);
    }
  }
  const groups: Array<MaterialInput & { merged_from: string[] }> = [];
  for (const input of inputs) {
    // Research identifiers are aliases: a DOI/arXiv link can connect confirmed versions.
    const current = groups.find((item) => {
      if (root(materialIdentity(item)) === root(materialIdentity(input))) return true;
      if (item.material_type !== "research" || input.material_type !== "research") return false;
      return item.identifiers.some((id) => input.identifiers.includes(id));
    });
    if (!current) {
      groups.push({
        ...input,
        factor_observations: { ...input.factor_observations },
        notes: [...input.notes],
        merged_from: [input.material_id],
      });
      continue;
    }
    for (const [key, observation] of Object.entries(input.factor_observations)) {
      if (current.notes.includes(`因素 ${key} 的来源冲突，暂不计入。`)) continue;
      const old = current.factor_observations[key];
      if (!old) current.factor_observations[key] = observation;
      else if (old.value !== observation.value) {
        const stateProgression =
          current.material_type === "research" &&
          key === "status" &&
          typeof old.value === "string" &&
          typeof observation.value === "string";
        if (!stateProgression) {
          delete current.factor_observations[key];
          current.notes.push(`因素 ${key} 的来源冲突，暂不计入。`);
          current.evidence_states = [...new Set([...current.evidence_states, "冲突/未能消歧" as const])];
        } else {
          const def = factorDefinitions[current.material_type].find((f) => f.key === key);
          const points = (value: string | number) => def?.choices.find((c) => c.key === value)?.points ?? 0;
          if (points(observation.value) > points(old.value)) current.factor_observations[key] = observation;
        }
      }
    }
    current.sources = uniqueEvidence([...current.sources, ...input.sources]);
    current.evidence_states = [...new Set([...current.evidence_states, ...input.evidence_states])];
    current.personal_action_evidence = uniqueEvidence([
      ...current.personal_action_evidence,
      ...input.personal_action_evidence,
    ]);
    current.identifiers = [...new Set([...current.identifiers, ...input.identifiers])];
    current.notes = [
      ...new Set([...current.notes, ...input.notes, "同一成果的重复记录已合并，不重复计分。"]),
    ];
    current.merged_from.push(input.material_id);
  }
  return groups.map((group) => ({ ...group, material_id: stableMaterialId(materialIdentity(group)) }));
}
export function scoreFactor(def: FactorDefinition, observation?: FactorObservation): FactorScore {
  const base = {
    key: def.key,
    label: def.label,
    weight: def.weight,
    value: observation?.value ?? null,
    evidence: observation?.evidence ?? null,
  };
  let points: number | null = null;
  if (observation && observation.evidence.quote.trim()) {
    if (
      def.kind === "size" &&
      typeof observation.value === "number" &&
      observation.value >= 0 &&
      Number.isFinite(observation.value)
    )
      points = 8 * Math.log1p(observation.value);
    else if (
      def.kind === "selectivity" &&
      observation.official &&
      typeof observation.value === "number" &&
      observation.value > 0 &&
      observation.value <= 1
    )
      points = 18 * -Math.log(observation.value);
    else if (!def.kind) points = def.choices.find((item) => item.key === observation.value)?.points ?? null;
  }
  return {
    ...base,
    points: points === null ? null : roundPoints(points),
    contribution: points === null ? null : roundPoints(points * def.weight),
    reason:
      points === null
        ? "没有符合规则的事实依据，保持 NA。"
        : def.kind === "size"
          ? "8 × ln(1 + 有效参赛规模)"
          : def.kind === "selectivity"
            ? "18 × -ln(官方公布比例)"
            : (def.choices.find((c) => c.key === observation?.value)?.label ?? ""),
  };
}
const actionPatterns: Record<AbilityKey, RegExp> = {
  professional_execution:
    /(?:从事|开发(?!者|工具|工程师|人员|岗)|实现|搭建|设计(?!师)|测试(?!工程师|岗位)|训练|部署|编写|构建|优化|重构|implement(?:ed|ing|s)?\b|develop(?:ed|ing|s)?\b|built\b|build(?:ing|s)?\b|design(?:ed|ing|s)?\b|test(?:ed|ing|s)?\b|deploy(?:ed|ing|s)?\b|cod(?:ed|ing)\b)\s*[^，。；;\n]{1,}/i,
  problem_solving:
    /(?:定位|排查|拆解|比较|权衡|解决|验证|复盘|分析|diagnos\w*|debug\w*|compar\w*|solv\w*|validat\w*|analy[sz]\w*)\s*[^，。；;\n]{1,}/i,
  ownership_delivery: /(?:负责|主导|承担|推进|推动|交付|领导|主要负责人|负责人|社长|团支书|owned|responsible for|deliver\w*)\s*[^，。；;\n]{1,}/i,
  collaboration_organization:
    /(?:协调|组织|带领|沟通|分工|跨团队推进|协同|推动|领导|主要负责人|负责人|社长|团支书|举办|联合|coordinat\w*|organiz\w*|led|collaborat\w*)\s*[^，。；;\n]{1,}/i,
  learning_research:
    /(?:研究(?!生|所|院|员)|学习|实验|复现|假设|消融|文献调研|learn(?:ed|ing|s)?\b|research(?:ed|ing)?\b|experiment(?:ed|ing|s)?\b|reproduc\w*|ablation)\s*[^，。；;\n]{1,}/i,
};
export function mapAction(material: MaterialInput, key: AbilityKey): AbilityMapping {
  // External project responsibilities and team outcomes never enter this list automatically.
  const positiveText = (quote: string) =>
    quote
      .split(/[。；;，,\n]|但是|但|however\b/i)
      .filter(
        (clause) =>
          !/未参与|未负责|未开发|未实现|未完成|未部署|未验证|尚未|没有|无法确认|not responsible|did not|\bnot\b/i.test(
            clause,
          ) &&
          !/^\s*(?:团队(?:共同)?|项目总体|同事|队友|其他成员|team\b|teammate\b|another member)/i.test(clause),
      )
      .join("，");
  const matched = material.personal_action_evidence.filter(
    (e) => e.origin === "resume" && actionPatterns[key].test(positiveText(e.quote)),
  );
  let selected: { level: keyof typeof actionLevels; evidence: Evidence } | undefined;
  for (const evidence of matched) {
    const text = positiveText(evidence.quote);
    const directTechnical = /(?:我|本人|独立|亲自|负责|主导|承担).{0,25}(?:开发|实现|搭建|设计|测试|训练|部署|编写|构建|优化|重构|develop|implement|design|test|deploy|code)/i.test(text);
    const leadership = /独立|负责|主导|承担|带领|领导|主要负责人|负责人|社长|团支书|owned|independen\w*|responsible for|led/i.test(text);
    if (key === "professional_execution" && !directTechnical) continue;
    const owned = key === "professional_execution" ? directTechnical : leadership;
    const validated =
      /上线|验收|交付|测试通过|验证通过|举办.{0,20}(?:场|次)|发布|推广|落地|降低.{0,25}\d|提升.{0,25}\d|复现成功|生产环境|deployed|delivered|production|reduced.{0,25}\d/i.test(
        text,
      );
    const level = /在指导下|协助|assisted|under guidance/i.test(text)
      ? "guided"
      : owned && validated
        ? "validated"
        : owned
          ? "owned"
          : "concrete";
    if (!selected || actionLevels[level] > actionLevels[selected.level]) selected = { level, evidence };
  }
  return {
    mapping_coefficient: selected
      ? actionCoefficients[key][selected.level]
      : isCatalogBackground(material)
        ? null
        : actionFloor,
    rule: selected?.level ?? null,
    mapping_reason: selected
      ? {
          guided: "在指导下完成具体行动",
          concrete: "有对象和动作的具体个人行动",
          owned: "明确承担该行动的责任",
          validated: "明确承担责任且有交付或验证结果",
        }[selected.level]
      : isCatalogBackground(material)
        ? "资料库背景条目不生成候选人个人能力贡献。"
        : `未找到直接行动证据，使用最低归因系数 ${actionFloor}，结果标记为暂定。`,
    supporting_evidence: selected ? [selected.evidence] : [],
    type_coefficient: typeAdaptation[material.material_type][key],
    derived_contribution: null,
  };
}

function isCatalogBackground(material: MaterialInput): boolean {
  return typeof material.external_facts.catalog_id === "string";
}

function awardPerformance(
  material: MaterialInput,
): { ratio: number | null; breakdown: NonNullable<ScoredMaterial["performance_breakdown"]> } {
  if (isCatalogBackground(material)) {
    return {
      ratio: 1,
      breakdown: {
        award_rate: null,
        selectivity_multiplier: null,
        tier_multiplier: null,
        reason: "资料库背景条目只使用赛事质量分，不代表候选人获奖表现。",
      },
    };
  }
  const rate = material.factor_observations.award_rate;
  const tier = material.factor_observations.tier;
  const p = rate && rate.official && typeof rate.value === "number" && rate.value > 0 && rate.value <= 1
    ? rate.value
    : null;
  const tierMultiplier = tier && typeof tier.value === "string" && Object.hasOwn(awardTierMultipliers, tier.value)
    ? awardTierMultipliers[tier.value as keyof typeof awardTierMultipliers]
    : null;
  const selectivityMultiplier = p === null
    ? null
    : roundPoints(Math.min(1, Math.max(0, -Math.log(p) / -Math.log(awardSelectivityReference))));
  const ratio = selectivityMultiplier !== null && tierMultiplier !== null
    ? roundPoints(selectivityMultiplier * tierMultiplier)
    : null;
  return {
    ratio,
    breakdown: {
      award_rate: p,
      selectivity_multiplier: selectivityMultiplier,
      tier_multiplier: tierMultiplier,
      reason: ratio === null
        ? "官方目标奖项比例或实际获奖层级不足，无法形成候选人表现比例。"
        : "表现比例 = 官方选择性系数 × 实际获奖层级系数。",
    },
  };
}

export function scoreMaterials(inputs: MaterialInput[], rho?: number) {
  const effectiveRho = rho ?? decayRatio;
  if (!Number.isFinite(effectiveRho) || effectiveRho <= 0 || effectiveRho >= 1)
    throw new Error("递减参数必须在 0 与 1 之间。");
  // Omitting rho selects the calibrated per-type decay. Passing rho explicitly
  // keeps the caller's single decay value, including an explicit 0.5.
  const decayForType = (type: MaterialType) => rho === undefined ? decayRatios[type] : effectiveRho;
  const materials: ScoredMaterial[] = deduplicate(inputs).map((material) => {
    const definitions = factorDefinitions[material.material_type];
    const rawBreakdown = definitions.map((def) => scoreFactor(def, material.factor_observations[def.key]));
    const breakdown = material.material_type === "award"
      ? rawBreakdown.map((factor) =>
          factor.key === "award_rate" || factor.key === "tier"
            ? { ...factor, contribution: null, reason: "该因素进入候选人表现比例，不直接进入赛事质量分。" }
            : factor,
        )
      : rawBreakdown;
    const known = breakdown.filter((item) => item.contribution !== null);
    const eventScore = material.material_type === "award"
      ? known.length
        ? roundPoints(known.reduce((sum, item) => sum + item.contribution!, 0))
        : null
      : null;
    const performance = material.material_type === "award" ? awardPerformance(material) : { ratio: null, breakdown: null };
    const score = material.material_type === "award"
      ? eventScore !== null && performance.ratio !== null
        ? roundPoints(eventScore * performance.ratio)
        : null
      : known.length
        ? roundPoints(known.reduce((sum, item) => sum + item.contribution!, 0))
        : null;
    const positiveDefinitions = definitions.filter((definition) => definition.weight > 0);
    const missingFactors = breakdown.filter((item) => item.points === null).map((item) => item.label);
    if (material.material_type === "award" && performance.ratio === null) {
      if (!material.factor_observations.award_rate) missingFactors.push("官方目标奖项比例（表现比例）");
      if (!material.factor_observations.tier) missingFactors.push("本赛事奖项层级（表现比例）");
    }
    const mapping = Object.fromEntries(
      abilityDimensions.map(({ key }) => {
        const value = mapAction(material, key);
        value.derived_contribution =
          score !== null && value.mapping_coefficient !== null
            ? roundPoints(score * value.type_coefficient * value.mapping_coefficient)
            : null;
        return [key, value];
      }),
    ) as Record<AbilityKey, AbilityMapping>;
    return {
      ...material,
      material_score: score,
      event_score: material.material_type === "award" ? eventScore : null,
      performance_ratio: material.material_type === "award" ? performance.ratio : null,
      performance_breakdown: material.material_type === "award" ? performance.breakdown : null,
      score_breakdown: breakdown,
      score_coverage: roundPoints(known.reduce((sum, item) => sum + item.weight, 0) / positiveDefinitions.reduce((sum, item) => sum + item.weight, 0)),
      missing_factors: [...new Set(missingFactors)],
      provisional: material.material_type === "award"
        ? known.length !== positiveDefinitions.length || performance.ratio === null
        : known.length !== breakdown.length,
      dimension_mapping: mapping,
    };
  });
  const abilities = Object.fromEntries(
    abilityDimensions.map(({ key }) => {
      const terms: ContributionTerm[] = [];
      for (const type of Object.keys(materialTypeLabels) as MaterialType[]) {
        const group = materials
          .filter((m) => m.material_type === type && m.dimension_mapping[key].derived_contribution !== null)
          .sort(
            (a, b) =>
              b.dimension_mapping[key].derived_contribution! -
                a.dimension_mapping[key].derived_contribution! || a.material_id.localeCompare(b.material_id),
          );
        group.forEach((m, index) => {
          const mapping = m.dimension_mapping[key];
          terms.push({
            material_id: m.material_id,
            title: m.title,
            material_type: type,
            material_score: m.material_score!,
            type_coefficient: mapping.type_coefficient,
            mapping_coefficient: mapping.mapping_coefficient!,
            derived_contribution: mapping.derived_contribution!,
            rank: index + 1,
            decay: decayForType(type) ** index,
            contribution: roundPoints(mapping.derived_contribution! * decayForType(type) ** index),
            evidence: mapping.supporting_evidence,
          });
        });
      }
      return [
        key,
        {
          score: terms.length ? roundPoints(terms.reduce((sum, term) => sum + term.contribution, 0)) : null,
          provisional: materials.some(
            (m) =>
              m.provisional ||
              m.dimension_mapping[key].derived_contribution === null ||
              (m.dimension_mapping[key].rule === null && !isCatalogBackground(m)),
          ),
          terms,
          missing_materials: materials.filter(
            (m) =>
              m.dimension_mapping[key].derived_contribution === null ||
              (m.dimension_mapping[key].rule === null && !isCatalogBackground(m)),
          ).length,
        },
      ];
    }),
  ) as Record<AbilityKey, AbilityScore>;
  const type_summaries = (Object.keys(materialTypeLabels) as MaterialType[]).map((type) => {
    const group = materials
      .filter((m) => m.material_type === type && m.material_score !== null)
      .sort((a, b) => b.material_score! - a.material_score!);
    return {
      type,
      count: materials.filter((m) => m.material_type === type).length,
      score: group.length
        ? roundPoints(group.reduce((sum, m, index) => sum + m.material_score! * decayForType(type) ** index, 0))
        : null,
    };
  });
  return { materials, abilities, type_summaries };
}
export type JobWeights = Record<AbilityKey, number>;
export type JobPreference = {
  title: string;
  weights: JobWeights;
  must_have: string[];
  rationale: string;
  version: typeof scoringVersion;
};
export const jobPresets = [
  { key: "general", title: "通用岗位", values: [0.2, 0.2, 0.2, 0.2, 0.2] },
  { key: "engineering", title: "工程开发岗", values: [0.35, 0.25, 0.25, 0.1, 0.05] },
  { key: "research", title: "研究算法岗", values: [0.2, 0.25, 0.1, 0.1, 0.35] },
  { key: "delivery", title: "项目交付岗", values: [0.2, 0.2, 0.35, 0.2, 0.05] },
  { key: "management", title: "团队管理岗", values: [0.15, 0.15, 0.25, 0.4, 0.05] },
] as const;
export function presetPreference(preset: (typeof jobPresets)[number] = jobPresets[0]): JobPreference {
  return {
    title: preset.title,
    weights: Object.fromEntries(
      abilityDimensions.map(({ key }, index) => [key, preset.values[index]]),
    ) as JobWeights,
    must_have: [],
    rationale: "初版岗位预设，可按当前招聘要求调整。",
    version: scoringVersion,
  };
}
export function normalizeJobPreference(value: unknown): JobPreference {
  if (!value || typeof value !== "object") throw new Error("岗位配置必须为对象。");
  const raw = value as Record<string, unknown>;
  const weights = raw.weights as Record<string, unknown> | undefined;
  if (!weights || Object.keys(weights).some((key) => !abilityDimensions.some((d) => d.key === key)))
    throw new Error("岗位权重只允许五个基础能力维度。");
  const pairs = abilityDimensions.map(({ key }) => [key, weights[key]] as const);
  if (pairs.some(([, weight]) => typeof weight !== "number" || !Number.isFinite(weight) || weight < 0))
    throw new Error("五项权重必须是非负有限数值。");
  const total = pairs.reduce((sum, [, weight]) => sum + (weight as number), 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error("权重总和必须为有限正数。");
  const conditions = Array.isArray(raw.must_have)
    ? raw.must_have
        .filter((v): v is string => typeof v === "string" && !!v.trim())
        .map((v) => v.trim().slice(0, 160))
        .slice(0, 12)
    : [];
  if (
    conditions.some((v) =>
      /年龄|性别|民族|宗教|婚育|国籍|残障|学校排名|公司名气|gender|ethnicity|religion/i.test(v),
    )
  )
    throw new Error("岗位条件应使用可验证的工作相关要求。");
  return {
    title: typeof raw.title === "string" ? raw.title.trim().slice(0, 160) : "",
    weights: Object.fromEntries(
      pairs.map(([key, weight]) => [key, (weight as number) / total]),
    ) as JobWeights,
    must_have: conditions,
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 500) : "",
    version: scoringVersion,
  };
}
export type ConditionResult = {
  condition: string;
  status: "supported" | "contradicted" | "unknown" | "conflict";
  evidence: string[];
};
export function evaluateCondition(condition: string, text: string, conflicting = false): ConditionResult {
  // Missing text is not a failed requirement. Complex numeric requirements stay unknown.
  if (conflicting) return { condition, status: "conflict", evidence: [] };
  if (/至少|不少于|年以上|年经验|at least|minimum|\d\s*years/i.test(condition))
    return { condition, status: "unknown", evidence: [] };
  const needle = normalizeIdentity(condition);
  const escaped = condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = (clause: string) =>
    /^[a-z][a-z0-9+#. -]*$/i.test(condition)
      ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(clause)
      : !!needle && normalizeIdentity(clause).includes(needle);
  const clauses = text.split(/[。；;，,\n]|但是|但|however\b/i).filter(matches);
  const negation = new RegExp(
    `(?:不具备|没有|不会|未掌握|不熟悉|未使用|not familiar(?: with)?|no experience(?: with| in)?|do not know|lack(?:s|ing)?)\\s*(?:使用|掌握)?\\s*${escaped}|no\\s+${escaped}\\s+experience`,
    "i",
  );
  const negative = clauses.filter((clause) => negation.test(clause));
  const positive = clauses.filter(
    (clause) =>
      !negative.includes(clause) && !/尚未|缺乏|没有|不会|未掌握|未使用|\bnot\b|\bno\b|\black/i.test(clause),
  );
  return {
    condition,
    status:
      positive.length && negative.length
        ? "conflict"
        : negative.length
          ? "contradicted"
          : positive.length
            ? "supported"
            : "unknown",
    evidence: clauses,
  };
}
export function rankAssessment(
  assessment: Assessment | undefined,
  preference: JobPreference,
  resumeText: string,
) {
  const job = normalizeJobPreference(preference);
  const conditions = job.must_have.map((condition) =>
    evaluateCondition(
      condition,
      resumeText,
      assessment?.materials.some(
        (m) =>
          m.evidence_states.includes("冲突/未能消歧") &&
          normalizeIdentity(m.resume_claim).includes(normalizeIdentity(condition)),
      ),
    ),
  );
  const required = abilityDimensions.filter(({ key }) => job.weights[key] > 0);
  const missing = required
    .filter(({ key }) => assessment?.abilities[key].score == null)
    .map(({ label }) => label);
  const knownContribution = assessment
    ? roundPoints(
        required.reduce((sum, { key }) => sum + (assessment.abilities[key].score ?? 0) * job.weights[key], 0),
      )
    : 0;
  const status: "excluded" | "conflict" | "pending" | "provisional" | "ready" = conditions.some(
    (c) => c.status === "contradicted",
  )
    ? "excluded"
    : conditions.some((c) => c.status === "conflict")
      ? "conflict"
      : !job.title ||
          !assessment ||
          assessment.version !== scoringVersion ||
          assessment.rho !== decayRatio ||
          missing.length ||
          conditions.some((c) => c.status === "unknown")
        ? "pending"
        : required.some(({ key }) => assessment.abilities[key].provisional)
          ? "provisional"
          : "ready";
  const comparisonKey = JSON.stringify({
    version: scoringVersion,
    title: job.title,
    weights: job.weights,
    conditions: job.must_have,
    rho: assessment?.rho,
  });
  const reasons = [
    !job.title ? "尚未指定岗位" : "",
    !assessment ? "尚未完成材料评估" : "",
    assessment && assessment.version !== scoringVersion ? "评分版本不同" : "",
    assessment && assessment.rho !== decayRatio ? "递减参数不同" : "",
    missing.length ? `所需维度缺少证据：${missing.join("、")}` : "",
    conditions.some((c) => c.status === "unknown") ? "必备条件待核实" : "",
  ].filter(Boolean);
  return {
    score: status === "ready" || status === "provisional" ? knownContribution : null,
    knownContribution,
    status,
    missing,
    conditions,
    comparisonKey,
    reasons,
  };
}
