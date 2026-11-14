# 企业 Logo 资产

资料库中的企业 Logo 使用本地 SVG 资产，页面优先从这里加载，因此离线或 Logo 服务不可用时仍能正常显示。

- `alibaba.svg`、`huawei.svg`、`bytedance.svg`、`dji.svg`、`baidu.svg`、`xiaomi.svg`、`anthropic.svg`：来自 Simple Icons CDN 的品牌图标，按项目版本固定保存。
- `tencent.svg`、`microsoft.svg`、`catl.svg`、`jd.svg`、`openai.svg`、`ttc.svg`、`starbridge.svg`：项目内统一尺寸的品牌字标 / 示例图标，用于补充没有稳定公共图标源的条目。

新增企业时，建议将 SVG 文件命名为小写英文标识，并在 `shared/knowledge.ts` 的 `companyLogoPaths` 中登记路径。Logo 仅用于资料库识别，不代表候选人与该企业存在雇佣或合作关系。
