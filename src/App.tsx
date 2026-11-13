import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileText,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MessageSquareText,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { sampleResumes } from "./sample-resumes";
import type { Resume } from "./types";
import type { AnalysisEvent, AnalysisProgress, ResearchBatch } from "./research-types";
import { readAnalysisEvents } from "./analysis-stream";

type AgentHealth = { agent: boolean; webSearch: boolean; model: string };

type ResumeListResponse = { resumes: Resume[]; directory: string };

function ResearchResults({ batch }: { batch: ResearchBatch }) {
  const labels = { competition: "竞赛", paper: "论文", project: "项目" };
  const statuses = { cached: "数据库命中", researched: "已检索并入库", pending: "待补充", error: "检索失败" };
  return <div className="research-results" aria-label="成果资料核查结果">
    <strong>成果资料 · {batch.items.length} 项</strong>
    {batch.notes.map((note, index) => <p key={index}>{note}</p>)}
    {!batch.items.length && !batch.notes.length && <p>未提取到竞赛、论文或具体项目。</p>}
    {batch.items.map((result, index) => <details key={index}>
      <summary><span>{labels[result.item.kind]} · {String(result.item.input.competition_name ?? result.item.input.title ?? result.item.input.project_name)}</span><small>{statuses[result.status]}</small></summary>
      <blockquote>{result.item.evidence}</blockquote>
      {result.error && <p>{result.error}</p>}
      {result.item.notes.map((note, noteIndex) => <p key={noteIndex}>{note}</p>)}
      {result.report && <>
        <ul>{result.report.sources.filter((source) => source.url).map((source, sourceIndex) => <li key={sourceIndex}><a href={source.url!} target="_blank" rel="noreferrer">{source.title}</a><p>{source.information}</p></li>)}</ul>
        <details><summary>查看完整资料</summary><pre>{JSON.stringify(result.report, null, 2)}</pre></details>
      </>}
    </details>)}
  </div>;
}

function PdfReader({ url, title }: { url: string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
    setDocument(null);
    setPageNumber(1);
    setZoom(1);
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        loadingTask = pdfjs.getDocument({
          url,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          useSystemFonts: true,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        setDocument(pdf);
        setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "无法打开 PDF。");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    let page: PDFPageProxy | undefined;
    let renderTask: RenderTask | undefined;
    void (async () => {
      try {
        page = await document.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建 PDF 阅读画布。");
        const viewport = page.getViewport({ scale: zoom });
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
      } catch (cause) {
        if (!cancelled && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
          setError(cause instanceof Error ? cause.message : "无法渲染 PDF 页面。");
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      page?.cleanup();
    };
  }, [document, pageNumber, zoom]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-toolbar">
        <div className="pdf-page-controls">
          <button className="reader-button" onClick={() => setPageNumber((current) => Math.max(1, current - 1))} disabled={!document || pageNumber <= 1} title="上一页" aria-label="上一页"><ChevronLeft size={16} /></button>
          <span className="page-indicator">{loading ? "读取中" : `${pageNumber} / ${document?.numPages ?? 0}`}</span>
          <button className="reader-button" onClick={() => setPageNumber((current) => Math.min(document?.numPages ?? current, current + 1))} disabled={!document || pageNumber >= (document?.numPages ?? 1)} title="下一页" aria-label="下一页"><ChevronRight size={16} /></button>
        </div>
        <div className="pdf-zoom-controls">
          <button className="reader-button" onClick={() => setZoom((current) => Math.max(0.6, Math.round((current - 0.1) * 10) / 10))} disabled={zoom <= 0.6} title="缩小" aria-label="缩小"><Minus size={15} /></button>
          <span className="zoom-indicator">{Math.round(zoom * 100)}%</span>
          <button className="reader-button" onClick={() => setZoom((current) => Math.min(2, Math.round((current + 0.1) * 10) / 10))} disabled={zoom >= 2} title="放大" aria-label="放大"><Plus size={15} /></button>
        </div>
        <a className="reader-button download-link" href={url} download={title} title="下载 PDF" aria-label="下载 PDF"><ArrowDownToLine size={15} /></a>
      </div>
      <div className="pdf-canvas-wrap">
        {loading && <div className="reader-message"><LoaderCircle className="spin" size={18} />正在打开 PDF</div>}
        {error && <div className="reader-error">{error}</div>}
        <canvas ref={canvasRef} className={`pdf-canvas ${loading || error ? "hidden" : ""}`} aria-label={`${title} 第 ${pageNumber} 页`} />
      </div>
    </div>
  );
}

export default function App() {
  const [resumes, setResumes] = useState<Resume[]>(sampleResumes);
  const [selectedId, setSelectedId] = useState(sampleResumes[0].id);
  const [filter, setFilter] = useState("");
  const [roleRequirements, setRoleRequirements] = useState("");
  const [question, setQuestion] = useState("请根据职位要求分析这份简历，并给出有证据的匹配度评分。");
  const [answer, setAnswer] = useState("");
  const [agentError, setAgentError] = useState("");
  const [busy, setBusy] = useState(false);
  const [researchResults, setResearchResults] = useState<ResearchBatch | null>(null);
  const [includeResearch, setIncludeResearch] = useState(true);
  const [ocrText, setOcrText] = useState("");
  const analysisRequest = useRef(0);
  const analysisController = useRef<AbortController | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [importError, setImportError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const selected = resumes.find((resume) => resume.id === selectedId) ?? resumes[0];
  const filtered = useMemo(() => resumes.filter((resume) => `${resume.name} ${resume.role}`.toLowerCase().includes(filter.toLowerCase())), [resumes, filter]);

  useEffect(() => {
    analysisController.current?.abort();
    analysisRequest.current += 1;
    setBusy(false);
    setResearchResults(null);
    setOcrText("");
    setAnalysisProgress(null);
    return () => analysisController.current?.abort();
  }, [selectedId]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setAnalysisElapsed(0);
    const timer = setInterval(() => setAnalysisElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    loadResumes();
    fetch("/api/health").then((response) => response.json()).then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (selected?.source !== "pdf") {
      setPdfUrl("");
      return;
    }
    setPdfUrl(`/api/resumes/${encodeURIComponent(selected.id)}/file`);
  }, [selected]);

  async function loadResumes(selectFirst = false) {
    try {
      const response = await fetch("/api/resumes");
      if (!response.ok) throw new Error("无法读取简历文件夹。");
      const payload = await response.json() as ResumeListResponse;
      setResumes([...payload.resumes, ...sampleResumes]);
      if (selectFirst && payload.resumes[0]) setSelectedId(payload.resumes[0].id);
    } catch {
      setImportError("无法连接本地简历文件夹，请确认服务正在运行。");
    }
  }

  async function importPdfs(files?: FileList | null) {
    if (!files?.length) return;
    const pdfFiles = Array.from(files).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    setImportError("");
    setAnswer("");
    if (pdfFiles.length === 0) {
      setImportError("所选内容中没有 PDF 文件。");
      return;
    }
    setExtracting(true);
    const imported: Resume[] = [];
    const errors: string[] = [];
    for (const [index, file] of pdfFiles.entries()) {
      setImportProgress(`${index + 1} / ${pdfFiles.length}`);
      try {
        const response = await fetch("/api/resumes", {
          method: "POST",
          headers: { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name) },
          body: file,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "导入失败。");
        imported.push(payload as Resume);
      } catch (error) {
        errors.push(`${file.name}：${error instanceof Error ? error.message : "导入失败"}`);
      }
    }
    if (imported.length) {
      setResumes((current) => [...imported, ...current.filter((resume) => !imported.some((item) => item.id === resume.id))]);
      setSelectedId(imported[imported.length - 1].id);
    }
    setImportError(errors.join("\n"));
    setImportProgress("");
    setExtracting(false);
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  async function openResumeFolder() {
    try {
      const response = await fetch("/api/resumes/open-folder", { method: "POST" });
      if (!response.ok) throw new Error("无法打开本地文件夹。");
      await loadResumes();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "无法打开本地文件夹。");
    }
  }

  async function analyze() {
    if (!selected) return;
    const requestId = ++analysisRequest.current;
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error("分析响应超时，已完成资料仍可查看，请重试。")), 310_000);
    setBusy(true);
    setAgentError("");
    setAnswer("");
    setResearchResults(null);
    setAnalysisProgress({ stage: includeResearch ? "extracting" : "analyzing", message: "正在连接分析服务。" });
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeName: selected.name, resumeText: ocrText.trim() ? ocrText : selected.text, roleRequirements, question, includeResearch, streamProgress: true }),
        signal: controller.signal,
      });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
        const payload = await response.json();
        if (requestId !== analysisRequest.current) return;
        setResearchResults(includeResearch ? payload.research ?? null : null);
        if (!response.ok) throw new Error(payload.error || "分析请求失败。");
        setAnswer(payload.answer);
      } else {
        await readAnalysisEvents(response, (event: AnalysisEvent) => {
          if (requestId !== analysisRequest.current) return;
          if (event.type === "progress") setAnalysisProgress(event.progress);
          if (event.type === "answer") setAnswer((current) => event.replace ? event.text : current + event.text);
          if (event.type === "research") setResearchResults(event.research);
          if (event.type === "complete") { setAnswer(event.answer); setResearchResults(includeResearch ? event.research : null); }
          if (event.type === "error" && event.research) setResearchResults(event.research);
        });
      }
    } catch (error) {
      if (requestId !== analysisRequest.current) return;
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      setAgentError(reason instanceof Error ? reason.message : "无法连接 Agent 服务。");
    } finally {
      clearTimeout(timeout);
      if (analysisController.current === controller) analysisController.current = null;
      if (requestId === analysisRequest.current) setBusy(false);
    }
  }

  function stopAnalysis() {
    analysisRequest.current += 1;
    analysisController.current?.abort();
    setBusy(false);
    setAgentError("分析已停止，已完成的成果资料仍可查看。");
  }

  if (!selected) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Bohack 简历工作台首页">
          <span className="brand-mark"><BriefcaseBusiness size={17} strokeWidth={2.2} /></span>
          <span>bohack<span className="brand-dot">.</span></span>
        </a>
        <div className="topbar-divider" />
        <div className="workspace-name">招聘工作台 <ChevronDown size={14} /></div>
        <div className="topbar-spacer" />
        <div className="privacy-note"><ShieldCheck size={15} /> 本地存储</div>
        <button className="icon-button help-button" title="隐私与数据说明" aria-label="隐私与数据说明"><CircleHelp size={18} /></button>
        <div className="user-avatar" title="工作区">B</div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-title-row"><h1>简历库</h1><span className="count-badge">{resumes.length}</span></div>
            <p>所有候选人</p>
            <label className="search-box">
              <Search size={15} />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索姓名或岗位" aria-label="搜索简历" />
              {filter && <button onClick={() => setFilter("")} title="清除搜索" aria-label="清除搜索"><X size={14} /></button>}
            </label>
            <button className="import-button" onClick={() => fileInput.current?.click()} disabled={extracting}>
              {extracting ? <LoaderCircle className="spin" size={16} /> : <ArrowUpFromLine size={16} />}
              {extracting ? `正在识别 ${importProgress}` : "导入 PDF 简历"}
            </button>
            <input ref={fileInput} className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple onChange={(event) => importPdfs(event.target.files)} />
            <input ref={(element) => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} className="visually-hidden" type="file" multiple onChange={(event) => importPdfs(event.target.files)} />
            <div className="sidebar-file-actions">
              <button className="secondary-action" onClick={() => folderInput.current?.click()} disabled={extracting}><FolderOpen size={14} />导入文件夹</button>
              <button className="secondary-action" onClick={openResumeFolder} title="打开本地简历存储文件夹"><FolderOpen size={14} />打开存储位置</button>
            </div>
            {importError && <div className="inline-error" role="status">{importError}</div>}
          </div>

          <div className="list-label"><span>候选人</span><span>最近更新</span></div>
          <div className="candidate-list">
            {filtered.map((resume, index) => (
              <button className={`candidate-row ${resume.id === selected.id ? "selected" : ""}`} key={resume.id} onClick={() => { analysisRequest.current += 1; setBusy(false); setSelectedId(resume.id); setAnswer(""); setAgentError(""); setResearchResults(null); setOcrText(""); }}>
                <span className={`candidate-avatar avatar-${index % 4}`}>{resume.initials}</span>
                <span className="candidate-copy"><strong>{resume.name}</strong><span>{resume.role}</span></span>
                <span className="candidate-date">{resume.received}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="empty-list">没有匹配的简历</div>}
          </div>
          <div className="sidebar-footer"><span className="status-dot" /> 本地工作区 <span className="footer-count">{resumes.length} 份简历</span></div>
        </aside>

        <main className="document-column">
          <div className="document-header">
            <div className="document-person">
              <span className={`candidate-avatar large avatar-${Math.max(0, resumes.indexOf(selected)) % 4}`}>{selected.initials}</span>
              <div><div className="person-title"><h2>{selected.name}</h2><span className={selected.source === "demo" ? "sample-tag" : "pdf-tag"}>{selected.source === "demo" ? "示例资料" : "PDF"}</span></div><p>{selected.role}<span className="meta-dot">·</span>{selected.location}</p></div>
            </div>
            <div className="document-actions">
              {selected.source === "pdf" && pdfUrl && <a className="icon-button" href={pdfUrl} download={`${selected.name}.pdf`} title="下载原始 PDF" aria-label="下载原始 PDF"><ArrowDownToLine size={17} /></a>}
              <button className="analyze-button" onClick={analyze} disabled={busy || !health?.agent} title={!health?.agent ? "请先在 .env 配置模型服务" : "使用 Agent 分析这份简历"}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                {busy ? "分析中" : "分析简历"}
              </button>
            </div>
          </div>

          <div className="document-toolbar">
            <div className="document-tab"><FileText size={15} /><span>{selected.source === "pdf" ? (selected.fileName ?? `${selected.name}.pdf`) : "简历预览"}</span></div>
            <div className="reader-controls"><span>{selected.source === "pdf" ? "本地 PDF" : "示例资料"}</span><span className="toolbar-separator" /><span>{selected.size ? `${Math.max(1, Math.round(selected.size / 1024))} KB` : "A4"}</span></div>
          </div>

          <section className="reader-area" aria-label="简历阅读区">
            {selected.source === "pdf" && pdfUrl ? (
              <PdfReader key={selected.id} url={pdfUrl} title={selected.fileName ?? `${selected.name}.pdf`} />
            ) : (
              <div className="sample-page">
                <div className="sample-document-label"><span>BOHACK SAMPLE</span><span>简历资料 · 示例</span></div>
                <div className="sample-name-block"><div><h3>{selected.name}</h3><p>{selected.role} <span>·</span> {selected.location}</p></div><div className="sample-contact">人才档案<br />{selected.name.toLowerCase().replace(" ", ".")}@example.com</div></div>
                <div className="sample-summary">{selected.text.split("。")[0]}。</div>
                <div className="sample-section"><h4>工作经历</h4>{(selected.experiences ?? []).map((experience) => <article className="experience" key={experience.company}><div className="experience-heading"><div><strong>{experience.role}</strong><span>{experience.company}</span></div><time>{experience.period}</time></div><p>{experience.detail}</p></article>)}</div>
                <div className="sample-section"><h4>教育背景</h4><p className="sample-body">{selected.education}</p></div>
                <div className="sample-section"><h4>专业技能</h4><div className="skill-list">{selected.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div>
                <div className="sample-doc-footer">示例资料仅用于体验工作台。导入 PDF 后将在此处显示原始文件。</div>
              </div>
            )}
          </section>
        </main>

        <aside className="analysis-column">
          <div className="analysis-header"><div><span className="eyebrow">BOHACK AGENT</span><h2>分析工作区</h2></div><span className={`agent-indicator ${health?.agent ? "ready" : ""}`} title={health?.agent ? "模型已连接" : "等待配置模型服务"}><span /></span></div>
          <div className="agent-capabilities"><div><Sparkles size={14} /><span>简历分析 Skill</span><Check size={14} className="capability-check" /></div><div><Globe2 size={14} /><span>网页搜索</span><span className={`capability-state ${health?.webSearch ? "available" : "unavailable"}`}>{health?.webSearch ? "已连接" : "待配置"}</span></div></div>
          <label className="field-label" htmlFor="role-requirements">职位要求 <span>可选</span></label>
          <textarea id="role-requirements" className="role-input" value={roleRequirements} onChange={(event) => setRoleRequirements(event.target.value)} placeholder="粘贴职位描述或关键要求，例如：5 年以上 B2B 产品经验，熟悉数据分析与团队协作……" rows={5} />
          <label className="field-label question-label" htmlFor="agent-question">分析任务</label>
          <textarea id="agent-question" className="question-input" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} />
          <label className="research-toggle"><input type="checkbox" checked={includeResearch} onChange={(event) => setIncludeResearch(event.target.checked)} disabled={busy} />核查竞赛、论文和项目资料</label>
          <p className="research-hint">优先查询本地资料库，缺失时联网补充。</p>
          <details className="ocr-input"><summary>补充 OCR 文本</summary><textarea aria-label="简历 OCR 文本" className="question-input" value={ocrText} onChange={(event) => setOcrText(event.target.value)} placeholder="扫描件可在此粘贴外部 OCR 结果；填写后将用于本次分析。" rows={4} disabled={busy} /></details>
          <button className="run-agent-button" onClick={analyze} disabled={busy || !health?.agent || !question.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy ? "Agent 正在分析" : "开始分析"}
          </button>
          {busy && <button className="stop-agent-button" onClick={stopAnalysis}>停止分析</button>}
          {!health?.agent && <div className="setup-hint"><span className="setup-icon"><CircleHelp size={15} /></span><span>配置服务密钥后即可运行分析。<code>OPENAI_API_KEY</code>{health ? "" : " · 服务连接中"}</span></div>}

          {researchResults && <ResearchResults batch={researchResults} />}
          <div className="result-heading"><div><MessageSquareText size={16} /><h3>分析结果</h3></div>{answer && <button className="clear-result" onClick={() => { setAnswer(""); setResearchResults(null); }} title="清除分析结果" aria-label="清除分析结果"><X size={15} /></button>}</div>
          <div className={`result-panel ${answer || agentError ? "has-result" : ""}`}>
            {busy ? <div className="working-state"><span className="working-mark"><Sparkles size={18} /></span><strong>{analysisProgress?.stage === "extracting" ? "正在提取成果信息" : analysisProgress?.stage === "researching" ? "正在核查成果资料" : "正在生成分析"}</strong><span role="status">{analysisProgress?.message || "正在处理分析请求。"}</span><span>已用时 {analysisElapsed} 秒</span>{Boolean(analysisProgress?.total) && <progress className="research-progress" max={analysisProgress!.total} value={analysisProgress!.completed ?? 0} aria-label="成果资料核查进度" />}<div className="loading-line"><i /></div></div> : agentError ? <div className="error-result"><strong>暂时无法完成分析</strong><p>{agentError}</p></div> : answer ? <div className="answer-content">{answer}</div> : <div className="empty-result"><span className="empty-result-icon"><Sparkles size={18} /></span><strong>等待开始分析</strong><p>设置职位要求后，Agent 会依据简历内容整理证据、差距与建议追问。</p><span className="evidence-note"><ShieldCheck size={13} /> 分析结论需由招聘人员复核</span></div>}
          </div>
          {busy && answer && <div className="answer-content partial-answer" aria-label="正在生成的分析正文">{answer}</div>}
          {!busy && agentError && answer && <div className="answer-content partial-answer">{answer}</div>}
          <div className="analysis-footer"><ShieldCheck size={14} /><span>分析仅作决策参考，避免将自动评分作为录用决定。</span></div>
        </aside>
      </div>
    </div>
  );
}
