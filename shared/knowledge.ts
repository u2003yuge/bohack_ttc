export type KnowledgeKind = "competition" | "journal" | "company";

export type KnowledgeRecord = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  aliases: string[];
  field: string;
  organizer: string;
  region: string;
  summary: string;
  signals: string[];
  officialUrl: string;
  significanceScore: number;
  scoreRationale: string;
  verificationStatus: "示例资料，待核验" | "已核验";
  updatedAt: string;
};

export const knowledgeKindLabels: Record<KnowledgeKind, string> = {
  competition: "竞赛",
  journal: "期刊 / 会议",
  company: "公司",
};

// Local seed records. The score is an explainable human-review starting point, not an objective ranking.
export const knowledgeRecords: KnowledgeRecord[] = [
  { id: "competition-acm-icpc", kind: "competition", title: "ICPC 国际大学生程序设计竞赛", aliases: ["ACM-ICPC", "ICPC"], field: "计算机 / 算法", organizer: "ICPC Foundation", region: "国际", summary: "以团队协作和算法编程能力为核心的大学生程序设计竞赛。", signals: ["团队协作", "算法与数据结构", "限时解题", "国际赛制"], officialUrl: "https://icpc.global/", significanceScore: 92, scoreRationale: "专业相关性强，能够提供算法能力和高压协作的直接证据；仍需核对赛区、名次和年份。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-ccpc", kind: "competition", title: "中国大学生程序设计竞赛", aliases: ["CCPC"], field: "计算机 / 算法", organizer: "中国大学生程序设计竞赛组委会", region: "中国", summary: "面向高校学生的程序设计竞赛，常用于观察算法基础和团队解题能力。", signals: ["算法", "编程实现", "团队协作", "区域赛 / 总决赛"], officialUrl: "https://ccpc.io/", significanceScore: 86, scoreRationale: "与软件工程岗位直接相关；评估时要区分参赛、获奖和具体赛区层级。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-kaggle", kind: "competition", title: "Kaggle 竞赛", aliases: ["Kaggle", "Kaggle competitions"], field: "数据科学 / 机器学习", organizer: "Kaggle", region: "国际", summary: "通过公开数据集和排名机制评估建模、特征处理和实验能力的平台型竞赛。", signals: ["数据建模", "实验迭代", "公开排名", "复现与解释"], officialUrl: "https://www.kaggle.com/competitions", significanceScore: 82, scoreRationale: "能体现数据实践和竞争结果，但需要核对竞赛规模、名次、团队角色和提交方案。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "competition-mcm", kind: "competition", title: "数学建模竞赛", aliases: ["MCM/ICM", "美国大学生数学建模竞赛"], field: "数学 / 建模 / 分析", organizer: "COMAP", region: "国际", summary: "以现实问题建模、分析论证和书面表达为核心的团队竞赛。", signals: ["问题抽象", "定量分析", "团队分工", "报告表达"], officialUrl: "https://www.comap.com/contests/mcm-icm", significanceScore: 78, scoreRationale: "对分析和结构化表达有参考价值；与岗位匹配度取决于岗位是否需要建模或研究能力。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-nature", kind: "journal", title: "Nature", aliases: ["自然"], field: "综合科学", organizer: "Nature Portfolio", region: "国际", summary: "综合性科学研究出版物，覆盖自然科学多个领域。", signals: ["研究质量", "同行评审", "跨学科影响", "论文贡献"], officialUrl: "https://www.nature.com/", significanceScore: 95, scoreRationale: "通常代表较强研究影响力信号，但必须核对作者贡献、文章类型和是否为正式发表。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-tpami", kind: "journal", title: "IEEE Transactions on Pattern Analysis and Machine Intelligence", aliases: ["IEEE TPAMI", "TPAMI"], field: "人工智能 / 计算机视觉", organizer: "IEEE", region: "国际", summary: "聚焦模式分析、机器智能和计算机视觉等方向的学术期刊。", signals: ["同行评审", "算法研究", "实验验证", "研究影响"], officialUrl: "https://www.computer.org/csdl/journal/tp", significanceScore: 91, scoreRationale: "对 AI 研究岗位具有较强相关性；需要核对论文作者排序、贡献和发表状态。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "journal-neurips", kind: "journal", title: "NeurIPS", aliases: ["Conference on Neural Information Processing Systems"], field: "人工智能 / 机器学习", organizer: "NeurIPS Foundation", region: "国际", summary: "机器学习和人工智能领域的重要学术会议之一。", signals: ["研究创新", "同行评审", "模型与实验", "公开交流"], officialUrl: "https://neurips.cc/", significanceScore: 92, scoreRationale: "对机器学习研究经历有较强参考价值；需区分正式接收、workshop、poster 和共同作者贡献。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-alibaba", kind: "company", title: "阿里巴巴", aliases: ["Alibaba"], field: "互联网 / 电商 / 云计算", organizer: "阿里巴巴集团", region: "中国", summary: "大型互联网企业，业务覆盖电商、云计算和数字服务等方向。", signals: ["业务规模", "复杂系统", "跨团队协作", "平台经验"], officialUrl: "https://www.alibabagroup.com/", significanceScore: 84, scoreRationale: "公司经历本身不能替代个人能力判断，应重点核对具体团队、职责、项目结果和个人贡献。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-tencent", kind: "company", title: "腾讯", aliases: ["Tencent"], field: "互联网 / 社交 / 游戏 / 云服务", organizer: "腾讯", region: "中国", summary: "大型科技企业，业务涵盖社交、数字内容、游戏和企业服务等方向。", signals: ["产品规模", "工程协作", "用户产品", "业务复杂度"], officialUrl: "https://www.tencent.com/", significanceScore: 84, scoreRationale: "品牌只提供背景信号，最终要回到岗位相关的可验证成果和面试追问。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-huawei", kind: "company", title: "华为", aliases: ["Huawei"], field: "通信 / ICT / 企业服务", organizer: "华为", region: "中国", summary: "面向通信、信息与通信技术和企业服务的科技企业。", signals: ["技术研发", "工程交付", "大型组织协作", "全球业务"], officialUrl: "https://www.huawei.com/", significanceScore: 83, scoreRationale: "可作为技术和大型项目环境的背景参考，不能仅凭公司名称推断个人能力。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
  { id: "company-startup-example", kind: "company", title: "星桥科技（示例）", aliases: ["Starbridge Tech"], field: "企业软件 / SaaS", organizer: "公开资料示例", region: "中国", summary: "用于演示早期公司经历如何结合产品阶段、职责范围和业务结果进行判断。", signals: ["职责跨度", "从 0 到 1", "快速迭代", "资源约束"], officialUrl: "", significanceScore: 70, scoreRationale: "早期公司经历的价值取决于职责边界和结果证据，不能用公司知名度简单替代。", verificationStatus: "示例资料，待核验", updatedAt: "2026-11-14" },
];
