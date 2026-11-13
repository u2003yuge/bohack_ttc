import type { Resume } from "./types";

export const sampleResumes: Resume[] = [
  {
    id: "sample-morgan",
    name: "Morgan Lee",
    role: "高级产品经理",
    location: "上海",
    received: "今天",
    initials: "ML",
    source: "demo",
    education: "香港科技大学 · 工商管理硕士",
    skills: ["产品战略", "数据分析", "B2B SaaS", "跨团队协作"],
    experiences: [
      { company: "Northstar Labs", role: "高级产品经理", period: "2022 - 至今", detail: "负责企业工作流产品，带领 8 人跨职能团队交付 3 个核心模块。新用户激活率提升 24%。" },
      { company: "ParcelOne", role: "产品经理", period: "2019 - 2022", detail: "重构商家入驻流程，处理时长由 5 天降至 2 天；建立产品分析看板并推动季度规划。" },
    ],
    text: "Morgan Lee，上海。高级产品经理，8 年 B2B SaaS 产品经验。Northstar Labs（2022 至今）：负责企业工作流产品，带领 8 人跨职能团队交付 3 个核心模块，新用户激活率提升 24%。ParcelOne（2019-2022）：重构商家入驻流程，处理时长由 5 天降至 2 天。香港科技大学工商管理硕士。技能：产品战略、数据分析、B2B SaaS、跨团队协作。",
  },
  {
    id: "sample-samira",
    name: "Samira Okafor",
    role: "数据分析师",
    location: "深圳",
    received: "昨天",
    initials: "SO",
    source: "demo",
    education: "中山大学 · 统计学硕士",
    skills: ["SQL", "Python", "实验设计", "Looker"],
    experiences: [
      { company: "Harbor Health", role: "数据分析师", period: "2021 - 至今", detail: "搭建留存分析体系，支持 4 条产品线决策；实验分析帮助降低 11% 的用户流失。" },
      { company: "Fieldnote", role: "商业分析师", period: "2018 - 2021", detail: "整合 12 个数据源并建立经营指标看板，每周为业务负责人输出洞察。" },
    ],
    text: "Samira Okafor，深圳。数据分析师，6 年分析工作经验。Harbor Health（2021 至今）：搭建留存分析体系，支持 4 条产品线决策；实验分析帮助降低 11% 的用户流失。Fieldnote（2018-2021）：整合 12 个数据源并建立经营指标看板。中山大学统计学硕士。技能：SQL、Python、实验设计、Looker。",
  },
  {
    id: "sample-jordan",
    name: "Jordan Patel",
    role: "前端工程师",
    location: "杭州",
    received: "2026/10/28",
    initials: "JP",
    source: "demo",
    education: "浙江大学 · 计算机科学学士",
    skills: ["React", "TypeScript", "可访问性", "性能优化"],
    experiences: [
      { company: "Clearwater Studio", role: "前端工程师", period: "2022 - 至今", detail: "构建设计系统和复杂数据工作台，将首屏加载时间缩短 38%。" },
      { company: "Minted Market", role: "软件工程师", period: "2019 - 2022", detail: "参与电商结账和账户体验建设，维护组件测试与发布流程。" },
    ],
    text: "Jordan Patel，杭州。前端工程师，7 年 Web 产品开发经验。Clearwater Studio（2022 至今）：构建设计系统和复杂数据工作台，将首屏加载时间缩短 38%。Minted Market（2019-2022）：参与电商结账和账户体验建设，维护组件测试与发布流程。浙江大学计算机科学学士。技能：React、TypeScript、可访问性、性能优化。",
  },
];
