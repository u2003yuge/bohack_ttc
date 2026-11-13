# Bohack 简历工作台

Bohack 是一个本地运行的招聘简历阅读与分析工作台。它可以导入 PDF、整理候选人、在应用内阅读原始简历，并通过可配置的 AI Agent 对照职位要求分析简历。PDF 和候选人数据默认保存在运行本项目的电脑上。

## 功能

- 在左侧简历库搜索并切换候选人。
- 导入单份 PDF、多份 PDF，或选择整个文件夹批量导入。
- 将原始 PDF 和候选人信息保存到本地简历目录。
- 使用应用内阅读器查看 PDF，支持翻页、缩放和下载。
- 提取 PDF 文本，并调用模型识别姓名、岗位、地点、教育背景、技能和简介。
- 粘贴职位要求，让 Agent 汇总证据、差距、建议追问及辅助评分。
- 可选接入 Tavily 网页搜索；分析 Skill 位于 `server/skills/resume-analysis.md`。
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
- 请确认你的模型和搜索服务的数据处理方式符合组织的招聘、隐私和数据保留要求。

## 项目结构

```text
src/                         React 工作台和 PDF 阅读器
server/index.ts              本地 API 与 Agent 工具调用
server/resumes.ts            PDF 文件夹、文本提取和候选人信息识别
server/skills/resume-analysis.md
                             简历分析 Skill 指令
.data/resumes/               默认本地简历目录（运行时创建，不提交）
```

## 构建和检查

```powershell
npm run build
npx tsc --noEmit --project tsconfig.server.json
```
