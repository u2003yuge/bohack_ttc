# Bohack 简历工作台

Bohack 是一个本地运行的招聘简历阅读与分析工作台。它可以导入 PDF、整理候选人、在应用内阅读原始简历，并通过可配置的 AI Agent 对照职位要求分析简历。PDF 和候选人数据默认保存在运行本项目的电脑上。

## 功能

- 在左侧简历库搜索并切换候选人。
- 导入单份 PDF、多份 PDF，或选择整个文件夹批量导入。
- 将原始 PDF 和候选人信息保存到本地简历目录。
- 使用应用内阅读器查看 PDF，支持翻页、缩放和下载。
- 自动加载 PDF.js 中文字符映射与标准字体资源，支持包含中文 CID 字体的 PDF。
- 提取 PDF 文本，并调用模型识别姓名、岗位、地点、教育背景、技能和简介。
- 粘贴职位要求，让 Agent 汇总证据、差距、建议追问及辅助评分。
- 可选接入 Tavily 网页搜索；分析 Skill 位于 `server/skills/resume-analysis.md`。
- 从 PDF 提取文本或外部 OCR 结果中提取竞赛、论文和项目，调用对应 Skill 联网核查，保存到项目根目录 `db/`，之后优先复用有效缓存。
- 从工作台打开本地简历文件夹，或将已有文件夹中的 PDF 导入工作台。

## 环境要求

- Node.js 20 或更高版本
- npm
- 一个兼容 OpenAI Chat Completions 接口的模型服务及 API Key
- Tavily API Key（可选；不配置时 Agent 不会进行网页搜索）

## 安装和启动

在项目根目录运行：

```powershell
npm install
```

在项目根目录新建 `.env` 文件，并按下一节填写配置。然后启动前端和本地 Agent 服务：

```powershell
npm run dev
```

`npm run dev` 和 `npm run build` 会自动从 PDF.js 复制中文 CMap 与标准字体到本地静态资源目录，无需手动下载。该生成目录已忽略，不会提交到 Git。

Vite 默认地址为 `http://127.0.0.1:5173/`。开发服务器仅监听本机回环地址。首次启动或修改 `.env` 后，请重启 `npm run dev`，让 Agent 服务重新读取配置。

## 环境变量

在项目根目录新建 `.env`，内容格式如下。替换示例占位值，不要把真实密钥放进代码、README 或提交记录。

```dotenv
# 必填：模型服务 API Key
OPENAI_API_KEY=your_model_api_key

# 可选：OpenAI 兼容服务的 API 根地址。
# 官方 OpenAI 服务使用默认值；第三方服务请填写服务商给出的 /v1 地址。
OPENAI_BASE_URL=https://api.openai.com/v1

# 必填：模型服务中实际可用的模型名称
OPENAI_MODEL=gpt-4.1-mini

# 可选：Tavily 搜索 API Key；可在 https://app.tavily.com/ 获取
TAVILY_API_KEY=your_tavily_api_key

# 可选：本地 Agent API 端口，默认 8787
PORT=8787

# 可选：简历文件夹。相对路径以项目根目录为基准；默认 .data/resumes
RESUME_DIR=.data/resumes
```

### 模型服务配置

`OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL` 必须对应同一个服务商账号和服务端点。`OPENAI_BASE_URL` 应是 API 根地址，应用会调用其 Chat Completions 接口。若使用 OpenAI 官方服务，可使用上面的默认地址；若使用兼容服务，请按服务商文档填写地址和模型标识。模型需要支持 Chat Completions、工具调用以及简历信息提取所需的普通对话请求。

### Tavily 搜索配置

从 Tavily 控制台创建 API Key 后填入 `TAVILY_API_KEY`。配置为空时，模型分析仍可使用，但网页搜索不可用。配置非空时，Agent 会在认为有助于回答时调用搜索工具；简历分析 Skill 限制搜索内容为职位相关公开信息，不允许借搜索调查候选人的敏感或私人信息。

## 简历文件夹和 PDF 导入

默认目录为项目根目录下的 `.data/resumes/`。每个导入的 PDF 会复制到此目录，候选人元数据保存在其 `.metadata/` 子目录。`.data/` 已加入 `.gitignore`，简历文件不会被 Git 跟踪或推送到 GitHub。

侧栏的“导入 PDF 简历”用于选择一个或多个文件；“导入文件夹”可选择一个已有目录并导入其中的 PDF；“打开存储位置”会在本机文件管理器中打开工作台自己的简历目录。也可以把 PDF 放入 `RESUME_DIR` 指定的目录，再刷新工作台，由服务扫描并索引新文件。

文本型 PDF 会提取文字，并尝试由模型识别候选人基本信息。扫描件或图片型 PDF 仍可在阅读器中查看，但当前版本没有 OCR，因此无法从纯图片页面提取文字或据此分析。请人工核对模型提取的信息和分析结果；评分仅作参考，不应单独作为招聘决定。

## 数据与隐私

- `.env`、`.env.*`、`.env.example` 和 `.data/` 均被 Git 忽略。项目不会提供可提交的密钥模板；请在本机创建 `.env`。
- 简历 PDF 和提取文本保存在本机 `RESUME_DIR`，不会因为导入操作自动上传到 GitHub。
- 导入 PDF 时，提取出的简历文本会发送给 `.env` 中配置的模型，用于整理候选人基本信息。用户主动运行分析时，简历文本、职位要求和提问也会发送给模型服务。
- 若 Agent 调用 Tavily，发送给搜索服务的是搜索查询和搜索请求，不会自动上传整份 PDF。
- 开启成果核查时，简历文本会额外发送给模型提取成果条目，再将成果名称、年份、机构等线索交给检索流程；成果报告保存在本机 `db/`，已加入 Git 忽略规则。关闭“核查竞赛、论文和项目资料”可跳过这一步。
- 请确认你的模型和搜索服务的数据处理方式符合组织的招聘、隐私和数据保留要求。

## 项目结构

```text
src/                         React 工作台和 PDF 阅读器
server/index.ts              本地 API 与 Agent 工具调用
server/resumes.ts            PDF 文件夹、文本提取和候选人信息识别
server/research/              成果输入提取、网页正文读取、报告校验与数据库缓存
server/skills/competition-award-evaluator/
server/skills/paper-value-evaluator/
server/skills/resume-project-research/
                             三类成果检索 Skill、参考规则和 JSON 模板
server/skills/resume-analysis.md
                             简历分析 Skill 指令
.data/resumes/               默认本地简历目录（运行时创建，不提交）
db/                          三类成果资料库（报告运行时创建，不提交）
```

## 构建和检查

```powershell
npm run build
npx tsc --noEmit --project tsconfig.server.json
npm test
```

## 竞赛、论文和项目资料核查

分析区默认勾选“核查竞赛、论文和项目资料”。点击分析后，服务先从简历文本中提取输入，附带连续原文证据，再查询 `db/`；缓存未命中且配置了 `TAVILY_API_KEY` 时，使用对应 Skill 搜索并读取网页正文，生成符合原模板的六块 JSON。界面实时显示提取、核查、生成分析的阶段、已用时间和完成项数；每项完成即展示资料，可展开查看原文证据、来源和完整报告。“停止分析”、切换候选人或关闭页面会取消后台模型与网页请求。

核查默认同时处理两项，每项最多 90 秒，整个资料提取与核查阶段最多 180 秒；到达时限后保留已完成资料，将剩余条目标为失败并继续基本简历分析。模型分析阶段最多 120 秒，正文随模型返回逐段显示，整个分析请求最多 300 秒。提取和研究阶段每次模型请求默认 60 秒且不自动重试，最终分析请求遵循分析阶段时限；网页请求最多 15 秒。超时、断线会明确显示错误并保留已收到的正文，避免持续转圈。首次检索仍可能需要数分钟，速度受配置的模型和成果数量影响。

可在本机 `.env` 中按需调整下列配置，修改后重启服务：

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `OPENAI_EXTRACTION_MODEL` | 跟随 `OPENAI_MODEL` | 提取成果所用模型，可填写服务商支持的较快模型 |
| `OPENAI_RESEARCH_MODEL` | 跟随 `OPENAI_MODEL` | 成果检索所用模型 |
| `MODEL_REQUEST_TIMEOUT_MS` | `60000` | 每次模型请求超时，毫秒 |
| `WEB_REQUEST_TIMEOUT_MS` | `15000` | 每次网页请求超时，毫秒 |
| `RESEARCH_ITEM_TIMEOUT_MS` | `90000` | 单项成果核查上限，毫秒 |
| `RESEARCH_TIMEOUT_MS` | `180000` | 提取与核查总时限，毫秒 |
| `ANALYSIS_TIMEOUT_MS` | `120000` | 最后生成分析阶段的总时限，毫秒 |
| `AGENT_TIMEOUT_MS` | `300000` | 整个分析请求总时限，毫秒 |

| 类型 | 提取的 skill 输入 | 可缺省 |
| --- | --- | --- |
| 竞赛 | `competition_name`、`award_name`、`award_year`、`age_at_award` | 获奖年龄；只保留原文明确写出的获奖时年龄，不计算、不用于评价 |
| 论文 | `title`、`description`；已提供的作者、年份、DOI 等映射到 `extra_context` | 描述和额外线索 |
| 项目 | `project_name`、`project_year`、`organization`、`role` | 角色；年份区间保留原文 |

缺少检索所需的名称、年份或所属机构时，保留 `null` 并提示待补充，不借用无关教育或工作信息。竞赛组别、赛区、阶段、论文版本等原文线索参与检索和缓存匹配；年龄不参与缓存匹配。系统采用保守的精确匹配，不自动合并简称或同名成果。

扫描件仍需外部 OCR：在“补充 OCR 文本”中粘贴识别结果后，它将替代本次分析的 PDF 文本；切换候选人会清空补充内容。此功能没有新增扫描件 OCR 引擎。

也可以直接调用 API，`text` 支持 1 到 100000 字符：

```http
POST /api/research/extract
Content-Type: application/json

{"text":"这里填写简历的 PDF 提取文本或 OCR 结果"}
```

`/api/research/extract` 只提取，返回 `{items, notes}`；每条包含 `kind`、`input`、`context`、`evidence`、`missingFields` 和 `notes`。`POST /api/research/enrich` 使用相同输入，额外查询数据库并检索，返回 `{items, notes}`，每条包含 `item`、`status`、`report` 和 `error`。`POST /api/agent` 支持可选布尔字段 `includeResearch`（默认 `true`），结果额外返回 `research`。传入 `streamProgress:true` 时，响应为 `application/x-ndjson`，逐行推送 `progress`、`research`、`answer`、`heartbeat`、`complete` 或 `error` 事件；`answer.text` 是生成中的正文片段，`answer.replace:true` 表示重置当前草稿。未传入时仍返回原有 JSON 响应。

未配置 Tavily 时仍会提取条目并查询已有缓存，未命中条目标为待补充，不声称完成联网核查。所有提取和生成都需要模型服务。来源必须是网页工具本次实际读取的正文；未知事实填 `null`，缺口写入 `notes`。身份或年份未确认的报告保存但不作为后续缓存命中。缓存默认有效 30 天，过期重查、保留旧版本，具体布局见 [db/README.md](db/README.md)。现有目录外的旧报告不会自动导入。

竞赛与项目 Skill 采集事实，不计算含金量；论文 Skill 按可核实的发表渠道、年份和轨道给出有限评价。公共资料无法证明简历持有人的实际获奖、署名、参与或个人贡献，分析时与简历自述分别处理。
