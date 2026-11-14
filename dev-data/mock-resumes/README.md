# 开发用 mock 简历池

这里保存 161 份开发阶段的固定 mock PDF：`1.pdf` 至 `160.pdf`，以及工作区原有的另一份 mock 简历。该目录由 Git 跟踪，随仓库拉取；各文件保留原文件名和原始二进制内容。

在项目根目录安装依赖后运行：

```powershell
npm run seed:resumes
npm run dev
```

准备命令将全部 161 份 PDF 复制到运行时简历目录，默认 `.data/resumes/`，也支持 `.env` 的 `RESUME_DIR` 或命令行指定目录：

```powershell
npm run seed:resumes -- .data/dev-resumes
```

`manifest.json` 保存每份 PDF 的文件名、字节数和 SHA-256。复制前校验整批源文件及同名冲突，复制后再次核对哈希；重复执行跳过内容相同的文件，遇到不同内容会停止，不覆盖已有文件。准备过程只复制 PDF，不调用 AI。打开工作台后，新文件会离线建立文字索引，点击分析后才运行 AI。

本目录只维护开发固定样本；候选人元数据、人工审核结果和分析报告存放在 `.data/` 下，继续由 `.gitignore` 排除。工作台的上传、删除和分析在运行时副本上执行，不修改这个固定样本池。
