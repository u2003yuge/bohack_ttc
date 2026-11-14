import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDownToLine,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpFromLine,
  BookOpen,
  ExternalLink,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  Download,
  FileText,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MessageSquareText,
  Minus,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Resume } from "./types";
import { CompetitionLibrary } from "./CompetitionLibrary";
import { VenueLibrary } from "./VenueLibrary";
import { CompanyLibrary } from "./CompanyLibrary";
import type { AnalysisEvent, AnalysisProgress, AnalysisResult } from "./research-types";
import { readAnalysisEvents } from "./analysis-stream";
import { calculateComposite, calculateGrowthTimeline, comparisonMapQuadrants, defaultScoreWeights, matchesComparisonMapRegion, normalizeWeights, scoreCriteria, type ComparisonMapAxis, type ComparisonMapRegion, type ComparisonRankCriterion, type ComparisonRankDraft, type ComparisonRatingFilter, type ScoreCard, type ScoreKey, type ScoreWeights } from "../shared/scoring";
import { calculateBenchmark, historicalYears, roleGroup, roleGroupLabel, type HistoricalCandidate } from "../shared/history";
import { findKnowledgeMatch, findKnowledgeReferences, getKnowledgeReadiness, knowledgeEvidenceSourceTypeLabels, knowledgeKindLabels, knowledgeReadinessStages, knowledgeRecords as seedKnowledgeRecords, knowledgeReviewTimelineX, knowledgeScoreBands, summarizeKnowledgeReadiness, summarizeKnowledgeScoreBands, type KnowledgeEvidenceFilter, type KnowledgeEvidenceSource, type KnowledgeEvidenceSourceType, type KnowledgeFilterDraft, type KnowledgeImportBundle, type KnowledgeKind, type KnowledgeReadiness, type KnowledgeRecord, type KnowledgeReviewEntry, type KnowledgeReviewFilter, type KnowledgeScoreBand, type KnowledgeSort, type KnowledgeVerificationFilter } from "../shared/knowledge";
import ScoringWorkspace from "./ScoringWorkspace";
import MaterialAssessment, { MaterialAssessmentRadar } from "./MaterialAssessment";

type AgentHealth = { agent: boolean; webSearch: boolean; model: string };
type ResumeDecision = "pending" | "passed" | "rejected";
type KnowledgeSource = { title: string; url: string; snippet: string };
type KnowledgeReviewSuggestion = { score: number; rationale: string };
type KnowledgeImportPreview = { bundle: KnowledgeImportBundle; insertCount: number; updateCount: number; insertReviewCount: number; updateReviewCount: number };
type RoleProfileProposal = { requirements: string; rationale: string };
type AnalysisTaskProposal = { question: string; rationale: string };
type WeightProposal = { weights: ScoreWeights; rationale: string };
type WeightImpact = { currentScore: number; proposedScore: number; currentRank: number; proposedRank: number; total: number; demoCount: number };
type AnalysisSection = { agentId: string; label: string; markdown: string; timing?: import("./research-types.js").AgentTiming };

type ResumeListResponse = { resumes: Resume[]; directory: string; skippedFiles?: Array<{ fileName: string; reason: string }> };
const defaultAiRoleRequirements = `岗位：AI 应用研发工程师
Base 地：上海 / 北京 / 深圳，可接受部分远程
岗位类型：全职，中高级
核心职责：
1. 负责大模型应用、RAG、Agent 工作流和文档智能分析系统的设计与开发；
2. 搭建模型调用、工具调用、评测、监控和数据闭环；
3. 与产品、算法、前端和业务团队协作，将 AI 能力落地到实际业务。
必须条件：
- 3 年以上软件或 AI 应用研发经验；
- 熟悉 Python 或 TypeScript；
- 熟悉 LLM API、Prompt、RAG、向量数据库或 Agent 框架；
- 具备完整项目交付经验。
优先条件：
- 有招聘、文档解析、知识库或企业效率工具经验；
- 有模型评测、数据治理、搜索增强或多 Agent 编排经验；
- 有清晰的量化成果、开源项目或论文竞赛经历。
分析重点：重点比较候选人的 AI 工程落地能力、系统设计能力、项目交付能力、问题解决能力和岗位契合度。`;
type PdfTextLine = { id: string; page: number; text: string; x: number; y: number; width: number; height: number; angle: number };
function boundedScore(value: number): number { return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)); }
function actualScore(value: number): number { return Math.max(0, Number.isFinite(value) ? value : 0); }
const awardPattern = /(奖|获奖|award|acm|icpc|ccf|竞赛|比赛|金牌|银牌|铜牌|一等奖|二等奖|三等奖|优胜奖|冠军|亚军|季军|csp)/i;
const paperPattern = /(论文|发表|期刊|会议|SCI|EI|DOI|学术|publication|paper|conference|journal)/i;
const educationPattern = /(教育背景|教育经历|学历|学士|硕士|博士|本科|研究生|大学|学院|毕业|GPA|专业排名)/i;
const projectPattern = /(项目|工作经历|工作经验|任职|实习|负责|主导|搭建|开发|设计|优化|交付|提升|降低|工程师|经理|主管|负责人|公司|企业)/i;
type PdfMaskCategory = "award" | "project" | "paper" | "education";
type PdfMaskAnnotation = { category: PdfMaskCategory; record?: KnowledgeRecord; score?: number };
const pdfMaskLabels: Record<PdfMaskCategory, string> = { award: "竞赛 / 奖项", project: "项目 / 工作", paper: "论文 / 期刊", education: "教育背景" };
function awardHeatColor(score: number): string {
  const normalized = Math.max(0, Math.min(100, score));
  const green = Math.round(224 - normalized * 1.55);
  const blue = Math.round(78 - normalized * 0.7);
  return `rgb(255 ${green} ${blue} / ${Math.round(30 + normalized * 0.3)}%)`;
}
function classifyPdfLine(text: string, records: KnowledgeRecord[]): PdfMaskAnnotation | null {
  const value = text.trim();
  if (!value) return null;
  const match = records.map((record) => ({ record, match: findKnowledgeMatch(value, record) })).filter((item): item is { record: KnowledgeRecord; match: string } => item.match !== null).sort((left, right) => right.match.length - left.match.length)[0];
  const score = match?.record.significanceScore ?? 0;
  if (match?.record.kind === "competition") return { category: "award", record: match.record, score };
  if (match?.record.kind === "journal") return { category: "paper", record: match.record, score };
  if (match?.record.kind === "company") return { category: "project", record: match.record, score };
  if (value.length < 4) return null;
  const sectionHeading = /^(教育背景|教育经历|工作经历|工作经验|项目经历|项目经验|论文|发表论文|科研成果|获奖经历|竞赛经历|荣誉奖项|教育情况)$/i.test(value);
  if (awardPattern.test(value) && (value.length >= 5 || sectionHeading)) return { category: "award", record: match?.record, score };
  if (paperPattern.test(value) && (value.length >= 6 || /(?:DOI|SCI|EI)/i.test(value))) return { category: "paper", record: match?.record, score };
  if (educationPattern.test(value) && (value.length >= 5 || sectionHeading)) return { category: "education", record: match?.record, score };
  if ((projectPattern.test(value) && (value.length >= 8 || sectionHeading) && /(?:负责|主导|搭建|开发|设计|优化|交付|提升|降低|工程师|经理|主管|负责人)/.test(value))) return { category: "project", record: match?.record, score };
  return null;
}
function normalizeEvidence(value: string): string { return value.toLocaleLowerCase().replace(/[\s\u3000]+/g, "").replace(/[，。；：、“”‘’（）()【】[\],.:;!?！？]/g, ""); }
function renderEvidenceText(value: string, query: string) {
  const target = query.trim();
  const index = target ? value.toLocaleLowerCase().indexOf(target.toLocaleLowerCase()) : -1;
  if (index < 0) return value;
  return <>{value.slice(0, index)}<mark className="sample-evidence-hit">{value.slice(index, index + target.length)}</mark>{value.slice(index + target.length)}</>;
}

function PdfReader({ url, title, evidenceTarget, knowledgeRecords, onEvidenceResult, onPreferredWidth }: { url: string; title: string; evidenceTarget: string; knowledgeRecords: KnowledgeRecord[]; onEvidenceResult: (result: { query: string; page: number | null }) => void; onPreferredWidth?: (width: number) => void }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [textLines, setTextLines] = useState<PdfTextLine[]>([]);
  const [awardLines, setAwardLines] = useState<PdfTextLine[]>([]);
  const [showAwardMask, setShowAwardMask] = useState(true);
  const [evidenceLineIds, setEvidenceLineIds] = useState<string[]>([]);
  const [openKnowledge, setOpenKnowledge] = useState<{ record: KnowledgeRecord; lineId: string; x: number; y: number; page: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
    setDocument(null);
    setPageNumber(1);
    setZoom(1);
    setTextLines([]);
    setAwardLines([]);
    setEvidenceLineIds([]);
    setOpenKnowledge(null);
    setPageErrors({});
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
    if (!document) return;
    let cancelled = false;
    const renderTasks: RenderTask[] = [];
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        setLoading(true);
        setPageErrors({});
        const detected: PdfTextLine[] = [];
        const pageTextLines: PdfTextLine[] = [];
        let preferredWidth = 0;
        for (let currentPage = 1; currentPage <= document.numPages; currentPage += 1) {
          if (cancelled) return;
          try {
          const page = await document.getPage(currentPage);
          const textContent = await page.getTextContent();
          const pageElement = pageRefs.current[currentPage - 1];
          const canvas = pageElement?.querySelector("canvas");
          const context = canvas?.getContext("2d");
          if (!canvas || !context) throw new Error("浏览器无法创建 PDF 阅读画布。");
          const baseViewport = page.getViewport({ scale: 1 });
          // Render at the requested document scale. The parent workspace grows
          // to accommodate the page, while the reader itself keeps horizontal
          // scrolling available when a user manually narrows the column.
          const renderScale = zoom;
          const nextPreferredWidth = Math.ceil(baseViewport.width * renderScale + 84);
          if (nextPreferredWidth > preferredWidth) {
            preferredWidth = nextPreferredWidth;
            onPreferredWidth?.(preferredWidth);
          }
          const viewport = page.getViewport({ scale: renderScale });
          const deviceScale = window.devicePixelRatio || 1;
          const maxCanvasDimension = 16384;
          const maxCanvasPixels = 16_777_216;
          const outputScale = Math.min(
            deviceScale,
            maxCanvasDimension / viewport.width,
            maxCanvasDimension / viewport.height,
            Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height)),
          );
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const textLines: PdfTextLine[] = [];
          for (const [itemIndex, rawItem] of textContent.items.entries()) {
            if (!("str" in rawItem) || !("transform" in rawItem) || !("width" in rawItem)) continue;
            const text = rawItem.str.trim();
            if (!text) continue;
            const transform = pdfjs.Util.transform(viewport.transform, rawItem.transform);
            const height = Math.max(8, Math.hypot(transform[2], transform[3]));
            const line: PdfTextLine = {
              id: `${currentPage}:${itemIndex}`,
              page: currentPage,
              text,
              x: transform[4],
              y: transform[5] - height,
              width: Math.max(1, rawItem.width * renderScale),
              height,
              angle: Math.atan2(transform[1], transform[0]),
            };
            textLines.push(line);
            pageTextLines.push(line);
            if (classifyPdfLine(text, knowledgeRecords)) detected.push(line);
          }
          const pageContent = pageElement?.querySelector<HTMLElement>(".pdf-page-content");
          if (pageContent) {
            pageContent.style.width = `${viewport.width}px`;
            pageContent.style.height = `${viewport.height}px`;
          }
          const renderTask = page.render({
            canvasContext: context,
            viewport,
            transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
          page.cleanup();
          } catch (cause) {
            if (cancelled || (cause instanceof Error && cause.name === "RenderingCancelledException")) return;
            const reason = cause instanceof Error ? cause.message : "无法渲染 PDF 页面。";
            const pageContent = pageRefs.current[currentPage - 1]?.querySelector<HTMLElement>(".pdf-page-content");
            if (pageContent && !pageContent.style.height) {
              pageContent.style.width = "100%";
              pageContent.style.height = "180px";
            }
            setPageErrors((current) => ({ ...current, [currentPage]: reason }));
          }
        }
        if (!cancelled) {
          setTextLines(pageTextLines);
          setAwardLines(detected);
          setLoading(false);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "无法渲染 PDF 页面。");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  }, [document, onPreferredWidth, zoom]);

  useEffect(() => {
    const query = normalizeEvidence(evidenceTarget);
    if (!query) { setEvidenceLineIds([]); return; }
    if (loading || !textLines.length) return;
    const linesByPage = new Map<number, PdfTextLine[]>();
    for (const line of textLines) linesByPage.set(line.page, [...(linesByPage.get(line.page) ?? []), line]);
    for (const [page, lines] of linesByPage) {
      const characters: string[] = [];
      const lineAtCharacter: string[] = [];
      for (const line of lines) {
        const normalized = normalizeEvidence(line.text);
        for (const character of normalized) { characters.push(character); lineAtCharacter.push(line.id); }
      }
      const pageText = characters.join("");
      const start = pageText.indexOf(query);
      if (start < 0) continue;
      const ids = [...new Set(lineAtCharacter.slice(start, start + query.length))];
      setEvidenceLineIds(ids);
      onEvidenceResult({ query: evidenceTarget, page });
      setPageNumber(page);
      const viewer = viewerRef.current;
      const target = ids[0] ? globalThis.document.getElementById(`pdf-text-${ids[0]}`) : null;
      if (viewer && target) {
        const top = viewer.scrollTop + target.getBoundingClientRect().top - viewer.getBoundingClientRect().top - 90;
        viewer.scrollTo({ top, behavior: "smooth" });
      }
      return;
    }
    setEvidenceLineIds([]);
    onEvidenceResult({ query: evidenceTarget, page: null });
  }, [document, evidenceTarget, loading, onEvidenceResult, textLines]);

  function goToPage(nextPage: number) {
    const target = Math.min(document?.numPages ?? 1, Math.max(1, nextPage));
    setPageNumber(target);
    const viewer = viewerRef.current;
    const page = pageRefs.current[target - 1];
    if (viewer && page) {
      const top = viewer.scrollTop + page.getBoundingClientRect().top - viewer.getBoundingClientRect().top - 12;
      viewer.scrollTo({ top, behavior: "smooth" });
    }
  }

  function handleScroll() {
    const containerTop = viewerRef.current?.getBoundingClientRect().top ?? 0;
    let closestPage = pageNumber;
    let closestDistance = Number.POSITIVE_INFINITY;
    pageRefs.current.forEach((pageElement, index) => {
      if (!pageElement) return;
      const distance = Math.abs(pageElement.getBoundingClientRect().top - containerTop - 16);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = index + 1;
      }
    });
    if (closestPage !== pageNumber) setPageNumber(closestPage);
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-toolbar" aria-label="PDF 阅读操作栏">
        <div className="pdf-toolbar-section pdf-page-controls" aria-label="页面导航">
          <button className="reader-button" onClick={() => goToPage(pageNumber - 1)} disabled={!document || pageNumber <= 1} title="向上翻页" aria-label="向上翻页"><ArrowUp size={15} /></button>
          <span className="page-indicator">{loading ? "读取中" : `${pageNumber} / ${document?.numPages ?? 0}`}</span>
          <button className="reader-button" onClick={() => goToPage(pageNumber + 1)} disabled={!document || pageNumber >= (document?.numPages ?? 1)} title="向下翻页" aria-label="向下翻页"><ArrowDown size={15} /></button>
        </div>
        <span className="pdf-toolbar-divider" aria-hidden="true" />
        <div className="pdf-toolbar-section pdf-zoom-controls" aria-label="缩放控制">
          <button className="reader-button" onClick={() => setZoom((current) => Math.max(0.6, Math.round((current - 0.1) * 10) / 10))} disabled={zoom <= 0.6} title="缩小" aria-label="缩小"><Minus size={15} /></button>
          <span className="zoom-indicator">{Math.round(zoom * 100)}%</span>
          <button className="reader-button" onClick={() => setZoom((current) => Math.min(2, Math.round((current + 0.1) * 10) / 10))} disabled={zoom >= 2} title="放大" aria-label="放大"><Plus size={15} /></button>
        </div>
        <span className="pdf-toolbar-divider" aria-hidden="true" />
        <div className="pdf-toolbar-heatmap" title="竞赛、项目 / 工作、论文 / 期刊和教育背景统一使用含金量热力图">
          <span className="pdf-toolbar-label"><span className="award-swatch" />证据热力图</span>
          <span className="award-count" aria-label={`${awardLines.length} 个已识别证据`}>{awardLines.length}</span>
          <label className="pdf-toolbar-switch" title="显示或隐藏当前 PDF 中全部证据分类遮罩">
            <input className="switch-input" type="checkbox" role="switch" aria-label="显示证据热力图遮罩" checked={showAwardMask} onChange={(event) => setShowAwardMask(event.target.checked)} />
            <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
          </label>
          <span className="pdf-toolbar-gradient" aria-label="含金量由低到高"><span>低</span><i className="mask-legend-gradient" /><span>高</span></span>
        </div>
        <div className="pdf-toolbar-actions" aria-label="文件操作">
          <a className="reader-button" href={url} download={title} title="下载 PDF" aria-label="下载 PDF"><ArrowDownToLine size={15} /></a>
        </div>
      </div>
      <div ref={viewerRef} className="pdf-canvas-wrap" onScroll={handleScroll}>
        {loading && <div className="reader-message"><LoaderCircle className="spin" size={18} />正在打开 PDF</div>}
        {error && <div className="reader-error">{error}</div>}
        {document && !error && Array.from({ length: document.numPages }, (_, index) => (
          <div className="pdf-page" key={index} ref={(element) => { pageRefs.current[index] = element; }} data-page={index + 1}>
            <div className="pdf-page-label">第 {index + 1} 页</div>
            <div className="pdf-page-content">
              <canvas className="pdf-canvas" aria-label={`${title} 第 ${index + 1} 页`} />
              {pageErrors[index + 1] && <div className="reader-error pdf-page-error">第 {index + 1} 页无法显示：{pageErrors[index + 1]}</div>}
              <div className={`pdf-text-layer ${showAwardMask ? "awards-visible" : ""}`} aria-label="简历证据分类热力图覆盖层">
                {textLines.filter((line) => line.page === index + 1).map((line) => {
                  const annotation = showAwardMask ? classifyPdfLine(line.text, knowledgeRecords) : null;
                  const match = annotation?.record;
                  const maskStyle: CSSProperties = annotation ? { "--mask-color": awardHeatColor(annotation.score ?? 0) } as CSSProperties : {};
                  const annotationLabel = annotation ? `${pdfMaskLabels[annotation.category]} · ${match ? `资料库含金量 ${annotation.score ?? 0}/100` : "暂未匹配资料库，分值待核验"}` : "";
                  return <span id={`pdf-text-${line.id}`} data-evidence-hit={evidenceLineIds.includes(line.id) || undefined} className={`pdf-text-item ${annotation ? `pdf-mask-hit pdf-mask-${annotation.category}` : ""} ${match ? "award-linked" : ""}`} key={line.id} style={{ left: line.x, top: line.y, width: line.width, height: line.height, fontSize: line.height, transform: `rotate(${line.angle}rad)`, ...maskStyle }} role={match ? "button" : undefined} tabIndex={match ? 0 : undefined} aria-label={match ? `查看${match.title}资料` : annotationLabel || undefined} title={match ? `点击查看${match.title}资料` : annotationLabel || undefined} onClick={match ? () => setOpenKnowledge({ record: match, lineId: line.id, x: line.x, y: line.y + line.height + 8, page: line.page }) : undefined} onKeyDown={match ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenKnowledge({ record: match, lineId: line.id, x: line.x, y: line.y + line.height + 8, page: line.page }); } } : undefined}>{line.text}</span>;
                })}
              </div>
              {openKnowledge?.page === index + 1 && <aside className="pdf-knowledge-card" style={{ left: Math.max(8, Math.min(openKnowledge.x, (pageRefs.current[index]?.querySelector("canvas")?.clientWidth ?? 650) - 292)), top: openKnowledge.y }} aria-label={`${openKnowledge.record.title}资料`}><button type="button" className="pdf-knowledge-close" onClick={() => setOpenKnowledge(null)} aria-label="关闭资料卡"><X size={13} /></button><span className={`knowledge-type ${openKnowledge.record.kind}`}>{knowledgeKindLabels[openKnowledge.record.kind]}</span><strong>{openKnowledge.record.title}</strong><small>{openKnowledge.record.field || "领域待补充"} · {openKnowledge.record.region || "地区待补充"}</small><p>{openKnowledge.record.summary}</p><div className="pdf-knowledge-meta"><span>主办 / 所属</span><b>{openKnowledge.record.organizer || "待补充"}</b><span>资料库参考分</span><b>{openKnowledge.record.significanceScore} / 100</b><span>核验状态</span><b>{openKnowledge.record.verificationStatus === "已核验" ? "已核验" : "待核验"}</b></div><small className="pdf-knowledge-caveat">仅供背景参考，候选人的参赛经历、个人贡献或任职情况仍需单独核实。</small>{openKnowledge.record.officialUrl && <a href={openKnowledge.record.officialUrl} target="_blank" rel="noreferrer">查看官方网站 <ExternalLink size={11} /></a>}</aside>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type ProjectBreakdown = { title: string; plainTitle: string; goal: string; actions: string; outcome: string; sourceText: string };
type ProjectBreakdownDraft = { sourceIndex: number; title: string; plainTitle: string; goal: string; actions: string; outcome: string; evidence: string };

function translateRecruitingTerms(value: string): string {
  const terms: Array<[RegExp, string]> = [
    [/B2B\s*SaaS/gi, "面向企业的在线软件服务"], [/SaaS/gi, "在线软件服务"], [/KPI/gi, "关键工作指标"], [/OKR/gi, "目标和关键结果"], [/A\/?B\s*测试/gi, "比较两个方案哪个更有效"], [/ETL/gi, "把不同来源的数据整理到一起"], [/CI\/?CD/gi, "自动测试并发布代码"], [/RAG/gi, "让 AI 先查资料再回答"], [/LLM/gi, "大语言模型"], [/API/gi, "让不同软件互相传递数据的接口"], [/微服务/g, "把系统拆成多个可独立维护的小服务"], [/数据中台/g, "统一收集和使用业务数据的平台"], [/低代码/g, "少写代码就能搭建的工具"], [/留存分析/g, "查看用户是否持续使用产品"], [/增长实验/g, "用小范围测试验证增长办法"],
  ];
  return terms.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
}

function deriveProjects(candidate: Resume): ProjectBreakdown[] {
  const experiences = candidate.experiences ?? [];
  if (experiences.length) return experiences.slice(0, 4).map((experience) => {
    const sentences = experience.detail.split(/[。；;]/).map((item) => item.trim()).filter(Boolean);
    return { title: `${experience.company} · ${experience.role}`, plainTitle: translateRecruitingTerms(experience.role), goal: `在 ${experience.company} 负责与岗位相关的工作`, actions: translateRecruitingTerms(sentences.slice(0, 1).join("；") || experience.detail), outcome: translateRecruitingTerms(sentences.slice(1).join("；") || "简历未明确写出量化结果"), sourceText: experience.detail };
  });
  const chunks = candidate.text.split(/[。；\n]/).map((item) => item.trim()).filter((item) => /负责|主导|搭建|优化|项目|交付|提升|降低/.test(item));
  return chunks.slice(0, 4).map((chunk, index) => ({ title: `简历项目 ${index + 1}`, plainTitle: "把这段经历拆成可核对的工作任务", goal: "候选人希望解决的业务或技术问题（需人工核实）", actions: translateRecruitingTerms(chunk), outcome: "简历未明确写出量化结果", sourceText: chunk }));
}

function KnowledgeReferenceBar({ candidate, records, onOpen }: { candidate: Resume; records: KnowledgeRecord[]; onOpen: (id?: string) => void }) {
  const references = findKnowledgeReferences(candidate.text, records);
  return <section className="knowledge-reference-bar"><div><span className="eyebrow">CROSS REFERENCES</span><strong>资料库交叉引用</strong><small>只根据简历原文中的名称或别名匹配</small></div><div className="knowledge-reference-list">{references.length ? references.map((record) => <button key={record.id} onClick={() => onOpen(record.id)}><span className={`knowledge-reference-dot ${record.kind}`} />{record.title}<b>{record.significanceScore}</b></button>) : <span className="knowledge-reference-empty">未识别资料</span>}<button className="knowledge-reference-search" onClick={() => onOpen()}>打开资料库 <ExternalLink size={12} /></button></div></section>;
}

function radarPoint(index: number, value: number, radius: number, center: number): string {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / scoreCriteria.length;
  const safeValue = boundedScore(value);
  return `${center + Math.cos(angle) * radius * safeValue / 100},${center + Math.sin(angle) * radius * safeValue / 100}`;
}

function ScoreRadar({ card, selectedKey, onSelect }: { card: ScoreCard; selectedKey: ScoreKey | null; onSelect: (key: ScoreKey) => void }) {
  const center = 96;
  const radius = 67;
  const outer = scoreCriteria.map((_, index) => radarPoint(index, 100, radius, center)).join(" ");
  const values = scoreCriteria.map(({ key }) => actualScore(card.criteria[key].score));
  const area = values.map((value, index) => radarPoint(index, value, radius, center)).join(" ");
  return <div className="score-radar"><svg viewBox="0 0 192 192" role="group" aria-label="六项能力雷达图，选择维度查看评分依据"> <polygon points={outer} className="radar-grid" />{[25, 50, 75].map((level) => <polygon key={level} points={scoreCriteria.map((_, index) => radarPoint(index, level, radius, center)).join(" ")} className="radar-ring" />)}{scoreCriteria.map((_, index) => <line key={index} x1={center} y1={center} x2={radarPoint(index, 100, radius, center).split(",")[0]} y2={radarPoint(index, 100, radius, center).split(",")[1]} className="radar-axis" />)}<polygon points={area} className="radar-area" />{values.map((value, index) => { const [x, y] = radarPoint(index, value, radius, center).split(","); const criterion = scoreCriteria[index]; return <circle key={criterion.key} cx={x} cy={y} r="5" className={`radar-dot ${selectedKey === criterion.key ? "selected" : ""}`} role="button" tabIndex={0} aria-label={`${criterion.label} ${value.toFixed(0)} 分，查看评分依据`} aria-pressed={selectedKey === criterion.key} onClick={() => onSelect(criterion.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(criterion.key); } }}><title>{`${criterion.label} ${value.toFixed(0)} 分 · 查看评分依据`}</title></circle>; })}</svg><div className="radar-labels">{scoreCriteria.map(({ key, label }, index) => { const value = actualScore(card.criteria[key].score); return <button type="button" key={key} className={`radar-label radar-label-${index} ${selectedKey === key ? "selected" : ""}`} aria-pressed={selectedKey === key} onClick={() => onSelect(key)}>{label}<b className={value >= 100 ? "score-at-limit" : ""}>{value.toFixed(0)}</b></button>; })}</div></div>;
}

function ScoreContribution({ card, selectedKey, onSelect }: { card: ScoreCard; selectedKey: ScoreKey | null; onSelect: (key: ScoreKey) => void }) {
  const totalWeight = scoreCriteria.reduce((sum, criterion) => sum + card.weights[criterion.key], 0) || 100;
  return <section className="score-contribution"><div className="insight-section-head"><div><span className="eyebrow">SCORE DECOMPOSITION</span><h4>综合分贡献拆解</h4></div><span className="score-formula">按当前权重</span></div><div className="contribution-list">{scoreCriteria.map(({ key, label }) => { const criterion = card.criteria[key]; const score = actualScore(criterion.score); const visualScore = boundedScore(score); const atLimit = score >= 100; const contribution = score * card.weights[key] / totalWeight; return <button type="button" className={`contribution-row ${selectedKey === key ? "selected" : ""}`} key={key} aria-pressed={selectedKey === key} onClick={() => onSelect(key)} aria-label={`${label}，单项 ${score.toFixed(0)} 分，贡献 ${contribution.toFixed(1)} 分，点击查看评分依据`}><div className="contribution-row-head"><span>{label}</span><strong>{contribution.toFixed(1)} 分</strong><small>权重 {card.weights[key]}%</small></div><div className="contribution-track"><i className={atLimit ? "at-limit" : ""} style={{ width: `${visualScore}%` }} /><b className={atLimit ? "at-limit-marker" : ""} style={{ left: `${visualScore}%` }} /></div></button>; })}</div><p className="contribution-note">分数和贡献值显示实际计算结果；条形在 100 分位置停止，并以轻微高亮表示超出常规范围。</p></section>;
}

function ScoreTrend({ card, candidate }: { card: ScoreCard; candidate: Resume }) {
  const timeline = useMemo(() => calculateGrowthTimeline({ text: candidate.text, experiences: candidate.experiences, evaluatedAt: card.evaluatedAt }, card.criteria.growth.score), [candidate.text, candidate.experiences, card.criteria.growth.score, card.evaluatedAt]);
  const [selectedYear, setSelectedYear] = useState(timeline.at(-1)?.year ?? new Date().getFullYear());
  const selected = timeline.find((entry) => entry.year === selectedYear) ?? timeline.at(-1);
  useEffect(() => { setSelectedYear(timeline.at(-1)?.year ?? new Date().getFullYear()); }, [candidate.id, timeline]);
  const chartWidth = Math.max(260, timeline.length * 58 + 24);
  const x = (index: number) => timeline.length < 2 ? chartWidth / 2 : 34 + (index / (timeline.length - 1)) * (chartWidth - 52);
  const y = (score: number) => 104 - (boundedScore(score) / 100) * 72;
  const points = timeline.map((entry, index) => `${x(index)},${y(entry.score)}`).join(" ");
  return <div className="score-trend">
    <div className="trend-legend"><span>进步分年度累计曲线</span><small>当前进步分 {actualScore(card.criteria.growth.score).toFixed(1)} · 每年年末回看前 3 年累计</small></div>
    {timeline.length ? <>
      <div className="trend-chart-scroll"><svg viewBox={`0 0 ${chartWidth} 142`} style={{ width: `${chartWidth}px` }} role="img" aria-label="按年份累计计算的进步分增长曲线">
        {[0, 50, 100].map((tick) => <g key={tick}><line x1="28" y1={y(tick)} x2={chartWidth - 12} y2={y(tick)} className="trend-grid" /><text x="23" y={y(tick) + 3} textAnchor="end" className="trend-label">{tick}</text></g>)}
        <line x1="28" y1="104" x2={chartWidth - 12} y2="104" className="trend-axis" />
        {timeline.length > 1 && <polyline points={points} className="trend-line" />}
        {timeline.map((entry, index) => {
          const active = entry.year === selected?.year;
          return <g key={entry.year} className={`trend-point ${active ? "active" : ""}`} role="button" tabIndex={0} aria-label={`${entry.year} 年末，进步分 ${entry.score.toFixed(1)}`} aria-pressed={active} onClick={() => setSelectedYear(entry.year)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedYear(entry.year); } }}>
            <title>{`${entry.year} 年末 · 进步分 ${entry.score.toFixed(1)} · 近${entry.windowYears}年累计 ${entry.rollingContribution}`}</title>
            <circle cx={x(index)} cy={y(entry.score)} r={active ? 5 : 4} className="trend-dot" />
            <text x={x(index)} y="124" textAnchor="middle" className="trend-label">{entry.year}</text>
          </g>;
        })}
      </svg></div>
      {selected && <div className="trend-selection"><div className="trend-selection-head"><span>{selected.year} 年末 · 近 {selected.windowYears} 年滚动累计</span><strong>{selected.score.toFixed(1)} 分</strong></div>
        <div className="trend-criteria"><div className="trend-growth-summary"><span>本年度新增贡献</span><strong>{selected.annualContribution}</strong><small>累计贡献 {selected.rollingContribution}</small></div></div>
        <small className="trend-weight-note">计算口径：每年年末汇总该年及前 2 年的经历成果与奖项贡献，再将最新年度累计值校准到当前进步分。</small>
      </div>}
    </> : <div className="trend-empty"><strong>尚无可解析的成长时间线</strong><span>需要简历中的工作年份、项目年份或奖项年份才能生成进步分曲线。</span></div>}
  </div>;
}

function scoreCardFromAssessment(assessment: NonNullable<Resume["assessment"]>, fallback: ScoreCard): ScoreCard {
  const ability = (key: keyof NonNullable<Resume["assessment"]>["abilities"]) => assessment.abilities[key].score ?? 0;
  const values: Record<ScoreKey, number> = {
    leadership: ability("ownership_delivery"),
    expertise: ability("professional_execution"),
    experience: ability("problem_solving"),
    perspective: ability("collaboration_organization"),
    roleFit: Math.round((ability("professional_execution") + ability("problem_solving")) / 2),
    growth: ability("learning_research"),
  };
  const criteria = Object.fromEntries(scoreCriteria.map(({ key }) => [key, { score: values[key], evidence: [] }])) as unknown as ScoreCard["criteria"];
  const totalWeight = scoreCriteria.reduce((sum, item) => sum + fallback.weights[item.key], 0) || 100;
  const composite = Math.round(scoreCriteria.reduce((sum, item) => sum + values[item.key] * fallback.weights[item.key], 0) / totalWeight * 10) / 10;
  return { ...fallback, criteria, composite, evaluatedAt: assessment.evaluatedAt };
}

function ProjectBreakdownView({ candidate, agentAvailable, onEvidence }: { candidate: Resume; agentAvailable: boolean; onEvidence: (evidence: string) => void }) {
  const projects = deriveProjects(candidate);
  const [reviewerFocus, setReviewerFocus] = useState("");
  const [draft, setDraft] = useState<ProjectBreakdownDraft[] | null>(null);
  const [showAiDraft, setShowAiDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestProjects = projects.map(({ title, sourceText }) => ({ title, content: sourceText }));
  const requestFingerprint = JSON.stringify({ projects: requestProjects, reviewerFocus: reviewerFocus.trim() });
  const currentFingerprint = useRef(requestFingerprint);
  currentFingerprint.current = requestFingerprint;
  async function explainProjects() {
    const fingerprint = requestFingerprint;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent/project-breakdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projects: requestProjects, reviewerFocus: reviewerFocus.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 项目拆解失败。");
      if (!Array.isArray(payload.projects) || payload.projects.length === 0) throw new Error("AI 没有返回带原文依据的项目拆解。");
      if (currentFingerprint.current !== fingerprint) throw new Error("经历或解读侧重点已修改，请重新生成草案。");
      setDraft(payload.projects as ProjectBreakdownDraft[]);
      setShowAiDraft(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 项目拆解失败。"); }
    finally { setBusy(false); }
  }
  const activeProjects = showAiDraft && draft ? draft : projects;
  return <section className="project-breakdown"><div className="insight-section-head"><div><span className="eyebrow">PROJECT BREAKDOWN</span><h4>项目拆解 · 人话版</h4></div><div className="project-breakdown-actions">{draft && <div className="project-breakdown-modes" role="group" aria-label="项目拆解展示模式"><button type="button" className={!showAiDraft ? "active" : ""} aria-pressed={!showAiDraft} onClick={() => setShowAiDraft(false)}>规则拆解</button><button type="button" className={showAiDraft ? "active" : ""} aria-pressed={showAiDraft} onClick={() => setShowAiDraft(true)}>AI 拆解</button></div>}<button type="button" className="project-ai-button" onClick={() => void explainProjects()} disabled={!agentAvailable || busy || !projects.length} title={!agentAvailable ? "请先配置模型服务" : "仅将当前列出的经历片段发送给模型"}>{busy ? <LoaderCircle className="spin" size={12} /> : <Sparkles size={12} />}{busy ? "拆解中" : "AI 人话拆解"}</button><span>{activeProjects.length} 项</span></div></div><label className="project-review-focus">AI 解读侧重点（可选）<input value={reviewerFocus} maxLength={500} onChange={(event) => { setReviewerFocus(event.target.value); setDraft(null); setShowAiDraft(false); setError(""); }} placeholder="例如：用非技术语言解释，重点说明个人贡献" /><small>仅随当前经历片段发送；修改后需重新生成</small></label>{error && <div className="inline-error" role="status">{error}</div>}{showAiDraft && draft && <p className="project-ai-note">AI 拆解已生成，原文依据可点击定位；信息不足处会明确标出，供面试追问。</p>}{activeProjects.length ? activeProjects.map((project) => <article className="project-item" key={`${project.title}-${"sourceIndex" in project ? project.sourceIndex : project.title}`}><div className="project-title"><strong>{project.plainTitle}</strong><span>{project.title}</span></div><dl><div><dt>要解决什么</dt><dd>{project.goal}</dd></div><div><dt>具体做了什么</dt><dd>{project.actions}</dd></div><div><dt>带来什么结果</dt><dd>{project.outcome}</dd></div></dl>{"evidence" in project && <button type="button" className="project-evidence-link" onClick={() => onEvidence(project.evidence)} title="在简历原文中定位 AI 引用">原文依据：{project.evidence}<ExternalLink size={10} /></button>}</article>) : <p className="project-empty">当前简历没有足够的项目描述，建议在面试中追问目标、个人贡献和结果。</p>}</section>;
}

function BenchmarkBadge({ role, score, candidates, onOpenHistory }: { role: string; score: number; candidates: HistoricalCandidate[]; onOpenHistory: (roleGroup: string, year: number | null, selectedId?: string) => void }) {
  const [year, setYear] = useState<number | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const safeScore = boundedScore(score);
  const benchmark = calculateBenchmark(role, actualScore(score), year, candidates);
  useEffect(() => { setYear(null); setSelectedHistoryId(null); }, [role]);
  const selectedHistory = benchmark.candidates.find((candidate) => candidate.id === selectedHistoryId);
  const lanes = [
    { key: "hired", label: "最终录取", candidates: benchmark.candidates.filter((candidate) => candidate.hired) },
    { key: "screened", label: "首轮通过未录取", candidates: benchmark.candidates.filter((candidate) => candidate.screened && !candidate.hired) },
    { key: "rejected", label: "未过首轮", candidates: benchmark.candidates.filter((candidate) => !candidate.screened) },
  ];
  const screenedSampleCount = benchmark.candidates.filter((candidate) => candidate.screened).length;
  const hiredSampleCount = benchmark.candidates.filter((candidate) => candidate.hired).length;
  const selectCandidate = (candidate: (typeof benchmark.candidates)[number]) => setSelectedHistoryId(candidate.id);
  const benchmarkCaveat = benchmark.sampleCount === 0
    ? "当前岗位族暂无历史样本，无法计算百分位或录用参考线。"
    : benchmark.sampleCount < 10
      ? `当前仅有 ${benchmark.sampleCount} 份历史样本，百分位和参考线容易受单条记录影响。`
      : "历史样本来自授权记录；参考线只用于辅助比较，不是录用规则。";
  const cohortLabel = benchmark.sampleRoleGroup === "all"
    ? "全部岗位族（当前岗位暂无样本）"
    : `${roleGroupLabel(benchmark.sampleRoleGroup)}岗位族`;
  return <section className="benchmark-card">
    <div className="benchmark-head"><div><span className="eyebrow">HISTORICAL BENCHMARK</span><div className="benchmark-percentile"><strong>{benchmark.percentile === null ? "暂无可比较样本" : `超过历史样本 ${benchmark.percentile}%`}</strong><span>{cohortLabel} · {benchmark.sampleCount} 份</span></div></div><div className="benchmark-year-filter" role="group" aria-label="筛选历史样本年份"><button className={year === null ? "active" : ""} onClick={() => { setYear(null); setSelectedHistoryId(null); }}>全部</button>{benchmark.availableYears.map((value) => <button className={year === value ? "active" : ""} key={value} onClick={() => { setYear(value); setSelectedHistoryId(null); }}>{value}</button>)}</div></div>
    <div className="benchmark-distribution" role="group" aria-label="历史候选人综合分分布图">
      {benchmark.sampleCount > 0 && <div className="benchmark-overlay" aria-hidden="true"><i className={`benchmark-current-line ${score >= 100 ? "score-at-limit" : ""}`} style={{ left: `${safeScore}%` }}><b>当前 {actualScore(score).toFixed(1)}</b></i>{benchmark.screenCutoff !== null && <i className="benchmark-screen-line" style={{ left: `${boundedScore(benchmark.screenCutoff)}%` }} />}{benchmark.hireCutoff !== null && <i className="benchmark-hire-line" style={{ left: `${boundedScore(benchmark.hireCutoff)}%` }} />}</div>}
      {lanes.map((lane) => <div className="benchmark-lane" key={lane.key}><span className="benchmark-lane-label"><span>{lane.label}</span><small>n={lane.candidates.length}</small></span><div className={`benchmark-lane-track ${lane.key}`}>{lane.candidates.map((candidate) => <button key={candidate.id} className={`benchmark-dot ${selectedHistoryId === candidate.id ? "selected" : ""}`} style={{ left: `${candidate.composite}%` }} title={`${candidate.year} · ${candidate.name} · ${candidate.composite} 分`} aria-label={`${candidate.year} ${candidate.name}，综合分 ${candidate.composite}，${candidate.screened ? "通过首轮" : "未通过首轮"}${candidate.hired ? "，最终录取" : ""}`} aria-pressed={selectedHistoryId === candidate.id} onClick={() => selectCandidate(candidate)} />)}</div></div>)}
      {benchmark.sampleCount === 0 && <div className="benchmark-no-samples">暂无历史样本，无法计算百分位或结果参考线。</div>}
      <div className="benchmark-axis"><span /><div><i>0</i><i>25</i><i>50</i><i>75</i><i>100</i></div></div>
    </div>
    <div className="benchmark-legend">{benchmark.sampleCount > 0 && <span><i className="legend-current" />当前候选人</span>}<span>{benchmark.screenCutoff !== null && <i className="legend-screen" />}{benchmark.screenCutoff === null ? "首轮参考线：暂无通过样本" : `首轮参考线 ${benchmark.screenCutoff} · n=${screenedSampleCount}`}</span><span>{benchmark.hireCutoff !== null && <i className="legend-hire" />}{benchmark.hireCutoff === null ? "录取参考线：暂无录取样本" : `录取参考线 ${benchmark.hireCutoff} · n=${hiredSampleCount}`}</span>{benchmark.sampleCount > 0 && <span><i className="legend-sample" />历史记录</span>}</div>
    {selectedHistory && <div className="benchmark-selected"><strong>{selectedHistory.name}</strong><span>{selectedHistory.year} 年 · {selectedHistory.composite} 分 · {selectedHistory.screened ? "通过首轮" : "未通过首轮"} · {selectedHistory.hired ? "最终录取" : "未录取"}</span><button onClick={() => setSelectedHistoryId(null)} aria-label="关闭历史样本详情"><X size={12} /></button></div>}
    <div className="benchmark-stats"><div><span>历史首轮通过率</span><strong>{benchmark.screenedRate}%</strong></div><div><span>历史录取率</span><strong>{benchmark.hiredRate}%</strong></div><div><span>首轮参考分数</span><strong>{benchmark.screenCutoff ?? "无该类样本"}</strong></div><div><span>录取参考分数</span><strong>{benchmark.hireCutoff ?? "无该类样本"}</strong></div></div>
    <p>{benchmarkCaveat} 百分位和参考线仅作辅助比较。</p>
    <button type="button" className="benchmark-database-link" onClick={() => onOpenHistory(benchmark.sampleRoleGroup, benchmark.year, selectedHistoryId ?? undefined)}><Database size={12} />查看当前样本库</button>
  </section>;
}

type HistoricalDraft = { role: string; year: number; composite: number | null; screened: boolean; hired: boolean };
type HistoricalResult = "rejected" | "screened" | "hired";
const historicalResultLabels: Record<HistoricalResult, string> = { rejected: "未通过初筛", screened: "通过初筛", hired: "录取" };
const historicalResult = (candidate: Pick<HistoricalCandidate, "screened" | "hired">): HistoricalResult => candidate.hired ? "hired" : candidate.screened ? "screened" : "rejected";
const emptyHistoricalDraft = (year: number = Math.max(...historicalYears)): HistoricalDraft => ({ role: "", year, composite: 70, screened: false, hired: false });

function HistoricalDatabaseView({ candidates, onCandidatesChange, initialFilter, initialSelectedId }: { candidates: HistoricalCandidate[]; onCandidatesChange: (candidates: HistoricalCandidate[]) => void; initialFilter: { roleGroup: string; year: number | null } | null; initialSelectedId: string }) {
  const [yearFilter, setYearFilter] = useState<number | null>(initialFilter?.year ?? null);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [editingId, setEditingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<HistoricalDraft>(emptyHistoricalDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState("");
  const years = [...new Set([...historicalYears, ...candidates.map((candidate) => candidate.year)])].sort((a, b) => a - b);
  const activeYear = yearFilter ?? candidates.find((candidate) => candidate.id === initialSelectedId)?.year ?? (candidates.length ? Math.max(...candidates.map((candidate) => candidate.year)) : years[0]);
  const filtered = candidates.filter((candidate) => candidate.year === activeYear).sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1) || (a.fileName && b.fileName ? a.fileName.localeCompare(b.fileName, "zh-CN", { numeric: true }) : a.name.localeCompare(b.name, "zh-CN")));

  function switchYear(year: number) {
    if (year === activeYear) return;
    setYearFilter(year); setSelectedId(""); setDeleteTargetId(""); setFormOpen(false); setEditingId(""); setError("");
  }
  function beginAdd() { setEditingId(""); setDraft(emptyHistoricalDraft(activeYear)); setError(""); setDeleteTargetId(""); setFormOpen(true); }
  function beginEdit(candidate: HistoricalCandidate) {
    if (candidate.source !== "local") return;
    setEditingId(candidate.id); setDraft({ role: candidate.role, year: candidate.year, composite: candidate.composite, screened: candidate.screened, hired: candidate.hired }); setError(""); setDeleteTargetId(""); setFormOpen(true);
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(editingId ? `/api/resumes/history/${encodeURIComponent(editingId)}` : "/api/resumes/history", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, name: candidates.find((candidate) => candidate.id === editingId)?.name }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法保存历史样本。");
      const candidate = payload.candidate as HistoricalCandidate;
      onCandidatesChange(editingId ? candidates.map((item) => item.id === editingId ? candidate : item) : [...candidates, candidate]);
      setYearFilter(candidate.year);
      setSelectedId(candidate.id); setEditingId(""); setDraft(emptyHistoricalDraft(candidate.year)); setFormOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存历史样本。"); }
    finally { setBusy(false); }
  }
  async function remove(candidate: HistoricalCandidate) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/resumes/history/${encodeURIComponent(candidate.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法删除历史样本。");
      onCandidatesChange(candidates.filter((item) => item.id !== candidate.id));
      setDeleteTargetId("");
      if (selectedId === candidate.id) setSelectedId("");
      if (editingId === candidate.id) { setEditingId(""); setFormOpen(false); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除历史样本。"); }
    finally { setBusy(false); }
  }

  const sampleForm = <form className="history-record-form" aria-label={editingId ? `编辑${candidates.find((candidate) => candidate.id === editingId)?.name ?? "样本"}` : "新增样本"} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {!editingId && <strong>新增样本</strong>}
          <label>岗位名称<input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} maxLength={120} required placeholder="例如：产品经理" disabled={busy} /></label>
          <label>综合分<input type="number" min="0" max="100" step="0.1" value={draft.composite ?? ""} onChange={(event) => setDraft({ ...draft, composite: event.target.value === "" ? null : Number(event.target.value) })} placeholder="未评分" disabled={busy} /></label>
          <label>招聘结果<select value={historicalResult(draft)} onChange={(event) => { const result = event.target.value as HistoricalResult; setDraft({ ...draft, screened: result !== "rejected", hired: result === "hired" }); }} disabled={busy}>{(Object.keys(historicalResultLabels) as HistoricalResult[]).map((result) => <option key={result} value={result}>{historicalResultLabels[result]}</option>)}</select></label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="history-form-actions"><button type="button" disabled={busy} onClick={() => { setFormOpen(false); setEditingId(""); setError(""); }}>取消</button><button type="submit" disabled={busy || !draft.role.trim()}>{busy ? "保存中" : editingId ? "保存" : "保存样本"}</button></div>
        </form>;

  return <main className="history-database-main history-list-page">
    <div className="history-database-shell">
      <header className="history-database-header"><h2>历史招聘样本库</h2></header>
      <div className="history-year-tabs" role="tablist" aria-label="招聘年份">
        {years.map((year) => <button type="button" key={year} id={`history-year-${year}`} role="tab" aria-selected={activeYear === year} aria-controls="history-year-panel" tabIndex={activeYear === year ? 0 : -1} className={activeYear === year ? "active" : ""} disabled={busy} onClick={() => switchYear(year)} onKeyDown={(event) => {
          const index = years.indexOf(year);
          const nextIndex = event.key === "ArrowRight" ? (index + 1) % years.length : event.key === "ArrowLeft" ? (index - 1 + years.length) % years.length : event.key === "Home" ? 0 : event.key === "End" ? years.length - 1 : null;
          if (nextIndex === null) return;
          event.preventDefault(); switchYear(years[nextIndex]); document.getElementById(`history-year-${years[nextIndex]}`)?.focus();
        }}>{year} 年<span>{candidates.filter((candidate) => candidate.year === year).length}</span></button>)}
      </div>
      <section id="history-year-panel" role="tabpanel" aria-labelledby={`history-year-${activeYear}`} className="history-samples-panel">
        <div className="history-list-toolbar">
          <span className="history-list-count">{filtered.length} 份样本</span>
          <button type="button" className="history-add-button" onClick={beginAdd} disabled={busy}><Plus size={16} />新增样本</button>
        </div>
        {formOpen && !editingId && sampleForm}
        {error && !formOpen && <div className="inline-error" role="alert">{error}</div>}
        <div className="comparison-table-wrap">
          <table className="comparison-table history-samples-table" aria-label={`${activeYear} 年历史样本`}>
            <thead><tr><th scope="col">排名</th><th scope="col">候选人</th><th scope="col">岗位</th><th scope="col">综合分</th><th scope="col">招聘结果</th><th scope="col">操作</th></tr></thead>
            <tbody>{filtered.map((candidate, index) => {
              const result = historicalResult(candidate);
              return <Fragment key={candidate.id}><tr className={`history-result-${result} ${candidate.id === selectedId ? "history-selected" : ""}`}>
                <td>{candidate.composite === null ? "—" : <span className={`rank-badge rank-${index + 1}`}>{index + 1}</span>}</td>
                <td>{candidate.fileName ? <a className="comparison-candidate-select" href={`/api/resumes/history/${encodeURIComponent(candidate.id)}/file`} target="_blank" rel="noreferrer" title={`打开 ${candidate.fileName}`} onClick={() => setSelectedId(candidate.id)}><strong>{candidate.name}</strong></a> : <button type="button" className="comparison-candidate-select" aria-pressed={candidate.id === selectedId} onClick={() => setSelectedId(candidate.id)}><strong>{candidate.name}</strong></button>}</td>
                <td>{candidate.role}</td>
                <td className="history-composite">{candidate.composite === null ? "未评分" : <strong>{candidate.composite.toFixed(1)}</strong>}</td>
                <td><span className={`history-result-badge ${result}`}>{historicalResultLabels[result]}</span></td>
                <td>{candidate.source === "local" ? <div className="history-record-actions">
                  <button type="button" onClick={() => beginEdit(candidate)} disabled={busy} aria-label={`编辑${candidate.name}`}><Pencil size={14} />编辑</button>
                  {deleteTargetId === candidate.id ? <><button type="button" onClick={() => void remove(candidate)} disabled={busy} aria-label={`确认删除${candidate.name}`}>确认删除</button><button type="button" onClick={() => setDeleteTargetId("")} disabled={busy}>取消</button></> : <button type="button" onClick={() => setDeleteTargetId(candidate.id)} disabled={busy} aria-label={`删除${candidate.name}`}>删除</button>}
                </div> : <span className="history-readonly">只读</span>}</td>
              </tr>{formOpen && editingId === candidate.id && <tr className="history-inline-editor"><td colSpan={6}>{sampleForm}</td></tr>}</Fragment>;
            })}</tbody>
          </table>
          {!filtered.length && <div className="history-list-empty">{activeYear} 年暂无历史样本</div>}
        </div>
      </section>
    </div>
  </main>;
}

function ScoreInsights({ card, candidate, records, historyCandidates: historyRecords, onOpenKnowledge, onOpenHistory, agentAvailable, onEvidence }: { card: ScoreCard; candidate: Resume; records: KnowledgeRecord[]; historyCandidates: HistoricalCandidate[]; onOpenKnowledge: (id?: string) => void; onOpenHistory: (roleGroup: string, year: number | null, selectedId?: string) => void; agentAvailable: boolean; onEvidence: (evidence: string) => void }) {
  const [selectedCriterion, setSelectedCriterion] = useState<ScoreKey | null>(null);
  const selected = selectedCriterion ? card.criteria[selectedCriterion] : null;
  const selectedLabel = scoreCriteria.find((criterion) => criterion.key === selectedCriterion)?.label;
  useEffect(() => { setSelectedCriterion(null); }, [candidate.id]);
  const composite = actualScore(card.composite);
  return <div className="score-insights"><BenchmarkBadge role={candidate.role} score={composite} candidates={historyRecords} onOpenHistory={onOpenHistory} /><KnowledgeReferenceBar candidate={candidate} records={records} onOpen={onOpenKnowledge} /><section className="score-visuals"><div className="insight-section-head"><div><span className="eyebrow">CAPABILITY PROFILE</span><h4>能力画像</h4></div><span className={`score-formula ${composite >= 100 ? "score-at-limit" : ""}`}>综合分 {composite.toFixed(1)}</span></div><div className="score-visual-grid"><ScoreRadar card={card} selectedKey={selectedCriterion} onSelect={setSelectedCriterion} /><ScoreTrend card={card} candidate={candidate} /></div></section><ScoreContribution card={card} selectedKey={selectedCriterion} onSelect={setSelectedCriterion} />{selected && selectedCriterion && <section className="score-evidence-panel" aria-live="polite"><div><span className="eyebrow">SCORE EVIDENCE</span><strong>{selectedLabel} · {actualScore(selected.score).toFixed(0)} 分</strong><small>评分证据 · 点击依据回到 PDF 定位</small></div>{selected.evidence.length ? <ul>{selected.evidence.map((item, index) => <li key={`${index}-${item}`}><button type="button" onClick={() => onEvidence(item)} title="在简历原文中定位这条依据">{item}<ExternalLink size={11} /></button></li>)}</ul> : <p>本项没有提取到明确依据。</p>}</section>}<ProjectBreakdownView key={candidate.id} candidate={candidate} agentAvailable={agentAvailable} onEvidence={onEvidence} /></div>;
}

type KnowledgeDraft = { title: string; kind: KnowledgeKind; aliases: string; field: string; organizer: string; region: string; summary: string; signals: string; officialUrl: string; evidenceSources: KnowledgeEvidenceSource[] };
type KnowledgeDraftProposal = Omit<KnowledgeDraft, "title" | "kind" | "aliases" | "signals" | "evidenceSources"> & { aliases: string[]; signals: string[]; confidence: number; rationale: string; unknowns: string[]; sources: KnowledgeSource[]; searchStatus: "searched" | "no-results" | "not-configured" | "unavailable"; inputFingerprint: string };
const emptyKnowledgeDraft: KnowledgeDraft = { title: "", kind: "competition", aliases: "", field: "", organizer: "", region: "", summary: "", signals: "", officialUrl: "", evidenceSources: [] };

function KnowledgeReviewHistory({ history, sources }: { history: KnowledgeReviewEntry[]; sources: KnowledgeEvidenceSource[] }) {
  const timeline = [...history].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  const [activeId, setActiveId] = useState(timeline.at(-1)?.id ?? "");
  useEffect(() => { setActiveId(timeline.at(-1)?.id ?? ""); }, [history.length]);
  if (!history.length) return <section className="knowledge-review-history"><div className="review-history-heading"><strong>评估记录</strong><span>尚无人工保存的评估</span></div></section>;
  const width = 400;
  const left = 28;
  const right = 390;
  const top = 12;
  const bottom = 92;
  const positions = knowledgeReviewTimelineX(timeline.map((entry) => entry.updatedAt), left, right);
  const pointX = (index: number) => positions[index];
  const pointY = (score: number) => bottom - score / 100 * (bottom - top);
  const active = timeline.find((entry) => entry.id === activeId) ?? timeline.at(-1)!;
  const activeSources = active.evidenceSources ?? (active.evidenceSourceIds ?? [])
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is KnowledgeEvidenceSource => Boolean(source));
  return <section className="knowledge-review-history">
    <div className="review-history-heading"><strong>评估记录</strong><span>{history.length} 次已保存审核 · 最近 30 次</span></div>
    <svg className="review-history-chart" viewBox={`0 0 ${width} 118`} role="group" aria-label="人工含金量评分历史">
      {[0, 50, 100].map((value) => <g key={value}><line x1={left} y1={pointY(value)} x2={right} y2={pointY(value)} className="review-history-grid" /><text x="2" y={pointY(value) + 3} className="review-history-axis-label">{value}</text></g>)}
      <polyline points={timeline.map((entry, index) => `${pointX(index)},${pointY(entry.significanceScore)}`).join(" ")} className="review-history-line" />
      {timeline.map((entry, index) => <g key={entry.id} className={`review-history-point ${entry.id === active.id ? "active" : ""}`} role="button" tabIndex={0} aria-label={`${new Date(entry.updatedAt).toLocaleString("zh-CN")}，${entry.significanceScore} 分，${entry.source === "ai-assisted" ? "AI 建议经人工确认" : "人工填写"}`} aria-pressed={entry.id === active.id} onClick={() => setActiveId(entry.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveId(entry.id); } }}>
        <circle cx={pointX(index)} cy={pointY(entry.significanceScore)} r={entry.id === active.id ? 5 : 3.5} />
      </g>)}
      <text x={left} y="112" className="review-history-date">{new Date(timeline[0].updatedAt).toLocaleDateString("zh-CN")}</text>
      {timeline.length > 1 && <text x={right} y="112" textAnchor="end" className="review-history-date">{new Date(timeline.at(-1)!.updatedAt).toLocaleDateString("zh-CN")}</text>}
      <text x={pointX(timeline.findIndex((entry) => entry.id === active.id))} y={Math.max(9, pointY(active.significanceScore) - 8)} textAnchor="middle" className="review-history-score">{active.significanceScore}</text>
    </svg>
    <div className="review-history-detail"><div><strong>{active.significanceScore}<small>/ 100</small></strong><span>{new Date(active.updatedAt).toLocaleString("zh-CN")}</span><span>{active.verificationStatus === "已核验" ? "已核验" : "待核验"}</span><span>{active.source === "ai-assisted" ? "AI 建议经人工确认" : "人工填写"}</span></div><p>{active.scoreRationale || "未填写评估依据。"}</p>{activeSources.length > 0 && <div className="review-history-sources"><span>本次引用</span>{activeSources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}<ExternalLink size={10} /></strong><small>{[knowledgeEvidenceSourceTypeLabels[source.sourceType], source.dataYear, source.verified ? "当时已核对" : "当时待核对"].filter(Boolean).join(" · ")}</small>{source.note && <small>{source.note}</small>}</a>)}</div>}</div>
  </section>;
}

type KnowledgeLibraryProps = { onClose: () => void; initialId?: string; resumes: Resume[]; records: KnowledgeRecord[]; onRecordsChange: (records: KnowledgeRecord[]) => void; onSelectEvidence: (id: string, evidence: string) => void; agentAvailable: boolean; webSearchAvailable: boolean };

function KnowledgeLibraryView(props: KnowledgeLibraryProps) {
  const [section, setSection] = useState<KnowledgeKind>(() => props.records.find((record) => record.id === props.initialId)?.kind ?? "competition");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [libraryId, setLibraryId] = useState(props.initialId);
  const targetKind = props.records.find((record) => record.id === props.initialId)?.kind;
  useEffect(() => {
    if (props.initialId) {
      const target = props.records.find((record) => record.id === props.initialId);
      if (target) { setSection(target.kind); setReviewId(null); setLibraryId(target.id); }
    }
  }, [props.initialId, targetKind]);
  const sectionRecords = props.records.filter((record) => record.kind === section);
  return <section className="knowledge-library-section" aria-label="资料库">
    <nav className="knowledge-section-tabs" aria-label="资料类别"><span>资料库</span>{(Object.keys(knowledgeKindLabels) as KnowledgeKind[]).map((kind) => <button key={kind} aria-pressed={section === kind} onClick={() => { setSection(kind); setReviewId(null); }}>
      {knowledgeKindLabels[kind]}<small>{props.records.filter((record) => record.kind === kind).length}</small>
    </button>)}{reviewId && <button className="knowledge-review-back" onClick={() => { setLibraryId(reviewId); setReviewId(null); }}>{section === "journal" ? "返回期刊会议资料" : "返回竞赛资料"}</button>}</nav>
    {section === "competition" && !reviewId ? <CompetitionLibrary records={sectionRecords} resumes={props.resumes} initialId={libraryId} onClose={props.onClose} onReview={setReviewId} onSelectEvidence={props.onSelectEvidence} />
      : section === "journal" && !reviewId ? <VenueLibrary records={sectionRecords} resumes={props.resumes} initialId={libraryId} onClose={props.onClose} onReview={setReviewId} onSelectEvidence={props.onSelectEvidence} />
      : section === "company" && !reviewId ? <CompanyLibrary records={sectionRecords} resumes={props.resumes} initialId={libraryId} onClose={props.onClose} onReview={setReviewId} onSelectEvidence={props.onSelectEvidence} />
      : <KnowledgeBaseView key={`${section}-${reviewId ?? "browse"}`} {...props} records={sectionRecords} initialId={reviewId ?? props.initialId}
        onRecordsChange={(next) => props.onRecordsChange([...next, ...props.records.filter((record) => record.kind !== section && !next.some((item) => item.id === record.id))])} />}
  </section>;
}

function KnowledgeBaseView({ onClose, initialId, resumes, records, onRecordsChange, onSelectEvidence, agentAvailable, webSearchAvailable }: KnowledgeLibraryProps) {
  void webSearchAvailable;
  const [kind, setKind] = useState<KnowledgeKind | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<KnowledgeSort>("default");
  const [verificationFilter, setVerificationFilter] = useState<KnowledgeVerificationFilter>("all");
  const [evidenceFilter, setEvidenceFilter] = useState<KnowledgeEvidenceFilter>("all");
  const [scoreBand, setScoreBand] = useState<KnowledgeScoreBand>("all");
  const [reviewFilter, setReviewFilter] = useState<KnowledgeReviewFilter>("all");
  const [readinessFilter, setReadinessFilter] = useState<KnowledgeReadiness | "all">("all");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [filterInstruction, setFilterInstruction] = useState("");
  const [filterProposal, setFilterProposal] = useState<KnowledgeFilterDraft | null>(null);
  const [filterAssistantBusy, setFilterAssistantBusy] = useState(false);
  const [filterAssistantError, setFilterAssistantError] = useState("");
  const [selectedId, setSelectedId] = useState(initialId && records.some((record) => record.id === initialId) ? initialId : seedKnowledgeRecords[0].id);
  const [reviewScore, setReviewScore] = useState(seedKnowledgeRecords[0].significanceScore);
  const [reviewNote, setReviewNote] = useState(seedKnowledgeRecords[0].scoreRationale);
  const [reviewSource, setReviewSource] = useState<"manual" | "ai-assisted">("manual");
  const [reviewSourceIds, setReviewSourceIds] = useState<string[]>([]);
  const [reviewProposal, setReviewProposal] = useState<KnowledgeReviewSuggestion | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<KnowledgeRecord["verificationStatus"]>(seedKnowledgeRecords[0].verificationStatus);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [roleContext, setRoleContext] = useState("");
  const [reviewerFocus, setReviewerFocus] = useState("");
  const [suggestionQuestions, setSuggestionQuestions] = useState<string[]>([]);
  const [suggestionSources, setSuggestionSources] = useState<KnowledgeSource[]>([]);
  const [suggestionConfidence, setSuggestionConfidence] = useState<number | null>(null);
  const [suggestionSearchStatus, setSuggestionSearchStatus] = useState<"searched" | "no-results" | "not-configured" | "unavailable" | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewSaved, setReviewSaved] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferNotice, setTransferNotice] = useState("");
  const [importPreview, setImportPreview] = useState<KnowledgeImportPreview | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [enrichmentHints, setEnrichmentHints] = useState("");
  const [enrichmentProposal, setEnrichmentProposal] = useState<KnowledgeDraftProposal | null>(null);
  const enrichmentRequestId = useRef(0);
  const knowledgeImportInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<KnowledgeDraft>(emptyKnowledgeDraft);
  void suggesting; void suggestionSources; void suggestionConfidence; void suggestionSearchStatus; void enrichmentBusy; void enrichDraft; void suggestReview;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const linkedResumeCounts = useMemo(() => new Map(records.map((record) => [record.id, resumes.filter((resume) => findKnowledgeMatch(resume.text, record) !== null).length])), [records, resumes]);
  const filtered = records.filter((record) => {
    const verificationMatches = verificationFilter === "all" || (verificationFilter === "verified" ? record.verificationStatus === "已核验" : record.verificationStatus !== "已核验");
    const hasSources = Boolean(record.officialUrl || record.evidenceSources?.length);
    const evidenceMatches = evidenceFilter === "all" || (evidenceFilter === "with-sources" && hasSources) || (evidenceFilter === "verified-sources" && record.evidenceSources?.some((source) => source.verified)) || (evidenceFilter === "without-sources" && !hasSources);
    const linkedMatches = !linkedOnly || (linkedResumeCounts.get(record.id) ?? 0) > 0;
    const selectedBand = knowledgeScoreBands.find((band) => band.key === scoreBand);
    const scoreMatches = !selectedBand || (record.significanceScore >= selectedBand.min && record.significanceScore <= selectedBand.max);
    const hasReview = Boolean(record.reviewHistory?.length);
    const reviewMatches = reviewFilter === "all" || (reviewFilter === "reviewed" ? hasReview : !hasReview);
    const readinessMatches = readinessFilter === "all" || getKnowledgeReadiness(record) === readinessFilter;
    return (kind === "all" || record.kind === kind) && verificationMatches && evidenceMatches && linkedMatches && scoreMatches && reviewMatches && readinessMatches && `${record.title} ${record.aliases.join(" ")} ${record.field} ${record.organizer} ${record.summary} ${record.signals.join(" ")} ${(record.evidenceSources ?? []).map((source) => `${source.title} ${source.dataYear} ${source.note}`).join(" ")}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const sortedRecords = [...filtered].sort((a, b) => sort === "score" ? b.significanceScore - a.significanceScore : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : 0);
  const selected = sortedRecords.find((record) => record.id === selectedId) ?? sortedRecords[0] ?? null;
  const enrichmentProposalStale = Boolean(enrichmentProposal && enrichmentProposal.inputFingerprint !== JSON.stringify({ draft, reviewerHints: enrichmentHints }));
  const kindSummary = (Object.keys(knowledgeKindLabels) as KnowledgeKind[]).map((value) => {
    const items = records.filter((record) => record.kind === value);
    const reviewed = items.filter((record) => record.verificationStatus === "已核验");
    const average = reviewed.length ? Math.round(reviewed.reduce((sum, record) => sum + record.significanceScore, 0) / reviewed.length) : null;
    return { kind: value, count: items.length, reviewed: reviewed.length, average };
  }).filter((item) => item.count > 0);
  const scoreBandCounts = summarizeKnowledgeScoreBands(records);
  const readinessCounts = summarizeKnowledgeReadiness(records);
  const evidenceCoverage = [
    { key: "with-sources" as const, label: "有来源", count: records.filter((record) => Boolean(record.officialUrl || record.evidenceSources?.length)).length },
    { key: "verified-sources" as const, label: "有已核来源", count: records.filter((record) => record.evidenceSources?.some((source) => source.verified)).length },
    { key: "without-sources" as const, label: "待补来源", count: records.filter((record) => !record.officialUrl && !record.evidenceSources?.length).length },
  ];

  useEffect(() => {
    if (initialId && records.some((record) => record.id === initialId)) {
      setKind("all"); setQuery(""); setVerificationFilter("all"); setEvidenceFilter("all"); setScoreBand("all"); setReviewFilter("all"); setReadinessFilter("all"); setLinkedOnly(false); setSelectedId(initialId);
    }
  }, [initialId, records]);
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id); setReviewScore(selected.significanceScore); setReviewNote(selected.scoreRationale); setVerificationStatus(selected.verificationStatus); setReviewSource("manual"); setReviewSourceIds(selected.reviewHistory?.at(-1)?.evidenceSourceIds ?? []); setReviewProposal(null); setReviewError(""); setReviewSaved(false); setDeleteConfirmation(false); setDeleteError("");
    setSuggestionQuestions([]); setSuggestionSources([]); setSuggestionConfidence(null); setSuggestionSearchStatus(null);
  }, [selected?.id]);

  async function exportKnowledgeBundle() {
    setTransferBusy(true); setTransferError(""); setTransferNotice("");
    try {
      const response = await fetch("/api/resumes/knowledge/export");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法导出资料库。");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = globalThis.document.createElement("a");
      anchor.href = url;
      anchor.download = `bohack-knowledge-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferNotice(`已导出 ${payload.records?.length ?? 0} 条自建资料及人工评估历史。`);
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "无法导出资料库。");
    } finally { setTransferBusy(false); }
  }

  async function previewKnowledgeImport(file?: File) {
    if (!file) return;
    setTransferBusy(true); setTransferError(""); setTransferNotice(""); setImportPreview(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("导入文件不能超过 2 MB。");
      const parsed = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/resumes/knowledge/import/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "文件校验失败。");
      setImportPreview(payload as KnowledgeImportPreview);
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "无法读取导入文件。");
    } finally { setTransferBusy(false); }
  }

  async function confirmKnowledgeImport() {
    if (!importPreview) return;
    setTransferBusy(true); setTransferError(""); setTransferNotice("");
    try {
      const response = await fetch("/api/resumes/knowledge/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(importPreview.bundle),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导入未完成。");
      onRecordsChange(payload.records as KnowledgeRecord[]);
      setSelectedId(importPreview.bundle.records[0]?.id ?? "");
      setKind("all"); setQuery(""); setVerificationFilter("all"); setEvidenceFilter("all"); setScoreBand("all"); setReviewFilter("all"); setReadinessFilter("all"); setLinkedOnly(false);
      setTransferNotice(`资料新增 ${payload.insertCount} 条、更新 ${payload.updateCount} 条；内置资料评估新增 ${payload.insertReviewCount ?? 0} 条、更新 ${payload.updateReviewCount ?? 0} 条。`);
      setImportPreview(null);
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "导入未完成。");
    } finally { setTransferBusy(false); }
  }

  function beginCreate() {
    enrichmentRequestId.current += 1;
    setEnrichmentBusy(false); setEditingId(null); setDraft({ ...emptyKnowledgeDraft, kind: records[0]?.kind ?? "competition" }); setEditorError(""); setEnrichmentHints(""); setEnrichmentProposal(null); setEditorOpen(true);
  }

  function beginEdit() {
    if (!selected) return;
    enrichmentRequestId.current += 1;
    setEditingId(selected.id);
    setDraft({ ...selected, aliases: selected.aliases.join("\n"), signals: selected.signals.join("\n"), evidenceSources: (selected.evidenceSources ?? []).map((source) => ({ ...source })) });
    setEnrichmentBusy(false); setEditorError(""); setEnrichmentHints(""); setEnrichmentProposal(null); setEditorOpen(true);
  }

  function closeEditor() {
    enrichmentRequestId.current += 1;
    setEnrichmentBusy(false); setEditorOpen(false); setEditingId(null); setDraft(emptyKnowledgeDraft); setEditorError(""); setEnrichmentHints(""); setEnrichmentProposal(null);
  }

  function addEvidenceSource() {
    if (draft.evidenceSources.length >= 12) return;
    setDraft((current) => ({ ...current, evidenceSources: [...current.evidenceSources, { id: crypto.randomUUID(), title: "", url: "", sourceType: "official", dataYear: "", note: "", verified: false, checkedAt: "" }] }));
  }

  function updateEvidenceSource(id: string, patch: Partial<KnowledgeEvidenceSource>) {
    setDraft((current) => ({ ...current, evidenceSources: current.evidenceSources.map((source) => {
      if (source.id !== id) return source;
      const changesSourceIdentity = ["title", "url", "sourceType", "dataYear"].some((key) => key in patch && patch[key as keyof KnowledgeEvidenceSource] !== source[key as keyof KnowledgeEvidenceSource]);
      return { ...source, ...patch, ...(changesSourceIdentity ? { verified: false, checkedAt: "" } : {}) };
    }) }));
  }

  async function enrichDraft() {
    if (!draft.title.trim()) return;
    const requestId = ++enrichmentRequestId.current;
    const requestDraft = draft;
    const requestHints = enrichmentHints;
    const inputFingerprint = JSON.stringify({ draft: requestDraft, reviewerHints: requestHints });
    setEnrichmentBusy(true); setEditorError(""); setEnrichmentProposal(null);
    try {
      const response = await fetch("/api/resumes/knowledge/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...requestDraft, aliases: requestDraft.aliases.split(/[\n,，]/).map((value) => value.trim()).filter(Boolean), signals: requestDraft.signals.split(/[\n,，]/).map((value) => value.trim()).filter(Boolean), reviewerHints: requestHints }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 资料整理失败。");
      if (requestId === enrichmentRequestId.current) setEnrichmentProposal({ ...payload.suggestion, sources: Array.isArray(payload.sources) ? payload.sources : [], searchStatus: payload.searchStatus ?? "not-configured", inputFingerprint });
    } catch (error) { if (requestId === enrichmentRequestId.current) setEditorError(error instanceof Error ? error.message : "AI 资料整理失败。"); }
    finally { if (requestId === enrichmentRequestId.current) setEnrichmentBusy(false); }
  }

  function applyEnrichment(replaceExisting: boolean) {
    if (!enrichmentProposal) return;
    if (enrichmentProposalStale) {
      setEditorError("资料内容已变化，请按当前内容重新生成草案。");
      return;
    }
    const currentAliases = draft.aliases.split(/[\n,，]/).map((value) => value.trim()).filter(Boolean);
    const currentSignals = draft.signals.split(/[\n,，]/).map((value) => value.trim()).filter(Boolean);
    const mergeLines = (current: string[], proposed: string[]) => [...new Set(replaceExisting ? proposed : [...current, ...proposed.filter((item) => !current.includes(item))])].join("\n");
    const chooseField = (current: string, proposed: string) => proposed.trim() && (replaceExisting || !current.trim()) ? proposed : current;
    setDraft({
      ...draft,
      aliases: mergeLines(currentAliases, enrichmentProposal.aliases),
      field: chooseField(draft.field, enrichmentProposal.field),
      organizer: chooseField(draft.organizer, enrichmentProposal.organizer),
      region: chooseField(draft.region, enrichmentProposal.region),
      summary: chooseField(draft.summary, enrichmentProposal.summary),
      signals: mergeLines(currentSignals, enrichmentProposal.signals),
      officialUrl: chooseField(draft.officialUrl, enrichmentProposal.officialUrl),
    });
    setEnrichmentProposal(null); setEditorError("");
  }

  async function saveRecord() {
    if (!draft.title.trim()) return;
    if (draft.evidenceSources.some((source) => !source.title.trim() || !/^https?:\/\//i.test(source.url.trim()))) {
      setEditorError("来源条目需要填写名称和 http(s) 链接；不需要的空条目请先移除。");
      return;
    }
    setEditorBusy(true); setEditorError("");
    const values = { ...draft, aliases: draft.aliases.split(/[\n,，]/).map((value) => value.trim()).filter(Boolean), signals: draft.signals.split(/[\n,，]/).map((value) => value.trim()).filter(Boolean) };
    try {
      const response = await fetch(editingId ? `/api/resumes/knowledge/${encodeURIComponent(editingId)}` : "/api/resumes/knowledge", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法保存资料。");
      const updated = payload.record as KnowledgeRecord;
      onRecordsChange(editingId ? records.map((record) => record.id === editingId ? updated : record) : [updated, ...records]);
      setSelectedId(updated.id); setKind("all"); setQuery(""); closeEditor();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "无法保存资料。");
    } finally { setEditorBusy(false); }
  }

  async function deleteSelectedRecord() {
    if (!selected || !selected.id.startsWith("custom-")) return;
    setDeleteBusy(true); setDeleteError("");
    try {
      const response = await fetch(`/api/resumes/knowledge/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法删除资料。");
      const remaining = records.filter((record) => record.id !== selected.id);
      onRecordsChange(remaining); setSelectedId((current) => current === selected.id ? remaining[0]?.id ?? "" : current); setDeleteConfirmation(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "无法删除资料。");
    } finally { setDeleteBusy(false); }
  }

  async function saveReview() {
    if (!selected) return;
    setSaving(true); setReviewError(""); setReviewSaved(false);
    try {
      const response = await fetch(`/api/resumes/knowledge/${encodeURIComponent(selected.id)}/review`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ significanceScore: reviewScore, scoreRationale: reviewNote, verificationStatus, source: reviewSource, evidenceSourceIds: reviewSourceIds }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法保存人工评估。");
      if (payload.record) { onRecordsChange(records.map((record) => record.id === selected.id ? payload.record : record)); setReviewSaved(true); }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "无法保存人工评估。");
    } finally { setSaving(false); }
  }

  async function suggestReview() {
    if (!selected) return;
    setSuggesting(true); setReviewError(""); setReviewSaved(false); setReviewProposal(null); setSuggestionQuestions([]); setSuggestionSources([]); setSuggestionConfidence(null); setSuggestionSearchStatus(null);
    try {
      const response = await fetch(`/api/resumes/knowledge/${encodeURIComponent(selected.id)}/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleContext, reviewerFocus }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 建议暂时不可用。");
      setReviewProposal({ score: payload.suggestion.score, rationale: payload.suggestion.rationale }); setSuggestionQuestions(payload.suggestion.verificationQuestions ?? []);
      setSuggestionSources(Array.isArray(payload.sources) ? payload.sources : []); setSuggestionConfidence(payload.suggestion.confidence ?? null); setSuggestionSearchStatus(payload.searchStatus ?? "not-configured");
    } catch (error) { setReviewError(error instanceof Error ? error.message : "AI 建议暂时不可用。"); }
    finally { setSuggesting(false); }
  }

  async function proposeKnowledgeFilters() {
    setFilterAssistantBusy(true); setFilterAssistantError(""); setFilterProposal(null);
    try {
      const response = await fetch("/api/resumes/knowledge/filter-draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: filterInstruction }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法生成筛选草案。");
      setFilterProposal(payload.suggestion as KnowledgeFilterDraft);
    } catch (error) { setFilterAssistantError(error instanceof Error ? error.message : "无法生成筛选草案。"); }
    finally { setFilterAssistantBusy(false); }
  }

  function countFilterProposalMatches(proposal: KnowledgeFilterDraft): number {
    const band = knowledgeScoreBands.find((item) => item.key === proposal.scoreBand);
    const search = proposal.query.trim().toLocaleLowerCase();
    return records.filter((record) => {
      const hasSources = Boolean(record.officialUrl || record.evidenceSources?.length);
      const statusMatches = proposal.verificationFilter === "all" || (proposal.verificationFilter === "verified" ? record.verificationStatus === "已核验" : record.verificationStatus !== "已核验");
      const reviewMatches = proposal.reviewFilter === "all" || (proposal.reviewFilter === "reviewed" ? Boolean(record.reviewHistory?.length) : !record.reviewHistory?.length);
      const readinessMatches = proposal.readiness === "all" || getKnowledgeReadiness(record) === proposal.readiness;
      const evidenceMatches = proposal.evidenceFilter === "all" || (proposal.evidenceFilter === "with-sources" && hasSources) || (proposal.evidenceFilter === "verified-sources" && record.evidenceSources?.some((source) => source.verified)) || (proposal.evidenceFilter === "without-sources" && !hasSources);
      const queryMatches = !search || `${record.title} ${record.aliases.join(" ")} ${record.field} ${record.organizer} ${record.summary} ${record.signals.join(" ")} ${(record.evidenceSources ?? []).map((source) => `${source.title} ${source.dataYear} ${source.note}`).join(" ")}`.toLocaleLowerCase().includes(search);
      return (proposal.kind === "all" || record.kind === proposal.kind) && statusMatches && reviewMatches && evidenceMatches
        && (!band || (record.significanceScore >= band.min && record.significanceScore <= band.max))
        && readinessMatches && (!proposal.linkedOnly || (linkedResumeCounts.get(record.id) ?? 0) > 0) && queryMatches;
    }).length;
  }

  function applyKnowledgeFilterProposal() {
    if (!filterProposal) return;
    setKind(filterProposal.kind); setVerificationFilter(filterProposal.verificationFilter);
    setEvidenceFilter(filterProposal.evidenceFilter); setScoreBand(filterProposal.scoreBand);
    setReviewFilter(filterProposal.reviewFilter); setReadinessFilter(filterProposal.readiness); setQuery(filterProposal.query); setLinkedOnly(filterProposal.linkedOnly); setSort(filterProposal.sort);
    setSelectedId(""); setFilterProposal(null);
  }

  const referencedResumes = selected ? resumes.flatMap((resume) => { const match = findKnowledgeMatch(resume.text, selected); return match ? [{ resume, match }] : []; }) : [];
  return (
    <main className="knowledge-main">
      <div className="knowledge-shell">
        <div className="knowledge-header">
          <div><span className="eyebrow">RESEARCH LIBRARY</span><h2>{records[0] ? knowledgeKindLabels[records[0].kind] : "资料"}资料管理</h2></div>
          <div className="knowledge-header-actions">
            <input ref={knowledgeImportInput} className="visually-hidden" type="file" accept=".json,application/json" aria-label="选择资料库备份文件" onChange={(event) => { void previewKnowledgeImport(event.target.files?.[0]); event.target.value = ""; }} />
            <button type="button" className="knowledge-transfer-button" onClick={() => void exportKnowledgeBundle()} disabled={transferBusy} title="导出自建资料和人工评估历史"><Download size={14} />导出</button>
            <button type="button" className="knowledge-transfer-button" onClick={() => { setTransferError(""); setImportPreview(null); knowledgeImportInput.current?.click(); }} disabled={transferBusy}><Upload size={14} />导入</button>
            <button className="back-to-workspace" onClick={onClose}>返回简历分析</button>
          </div>
        </div>
        {transferError && <div className="knowledge-transfer-message error" role="alert">{transferError}</div>}
        {transferNotice && <div className="knowledge-transfer-message" role="status">{transferNotice}</div>}
        {importPreview && <section className="knowledge-import-preview" aria-label="导入预览"><div><strong>导入预览 · {importPreview.bundle.records.length} 条自建资料</strong><p>资料新增 {importPreview.insertCount} 条、更新 {importPreview.updateCount} 条；内置资料评估新增 {importPreview.insertReviewCount} 条、更新 {importPreview.updateReviewCount} 条。只恢复内置资料的人工评估，不覆盖其资料正文。</p></div><button type="button" onClick={() => setImportPreview(null)} disabled={transferBusy}>取消</button><button type="button" onClick={() => void confirmKnowledgeImport()} disabled={transferBusy}>{transferBusy ? "正在导入" : "确认导入"}</button></section>}
        <section className="knowledge-overview" aria-label="资料库分类概览">
          <div className="knowledge-overview-heading"><div><strong>资料分布</strong><span>点击分类可筛选条目</span></div><small>已核验 {records.filter((record) => record.verificationStatus === "已核验").length} / {records.length}</small></div>
          <div className="knowledge-overview-grid">{kindSummary.map((item) => <button key={item.kind} className={`knowledge-overview-item ${kind === item.kind ? "active" : ""}`} onClick={() => setKind(kind === item.kind ? "all" : item.kind)} aria-pressed={kind === item.kind}>
            <span className="knowledge-overview-top"><strong>{knowledgeKindLabels[item.kind]}</strong><b>{item.count}</b></span>
            <span className="knowledge-overview-track" role="img" aria-label={`${knowledgeKindLabels[item.kind]}占资料库 ${records.length ? Math.round(item.count / records.length * 100) : 0}%`}><i style={{ width: `${records.length ? item.count / records.length * 100 : 0}%` }} /></span>
            <span className="knowledge-overview-bottom"><span>{item.reviewed} 条已核验</span><span>{item.average === null ? "均分待积累" : `核验均分 ${item.average}`}</span></span>
          </button>)}</div>
          <div className="knowledge-score-distribution" aria-label="资料评分档位及人工评估覆盖">
            <div className="knowledge-score-distribution-head"><strong>评分档位</strong><span>总数与人工评估覆盖 · 点击筛选</span></div>
            <div className="knowledge-score-bands">{scoreBandCounts.map((band) => <button type="button" key={band.key} className={scoreBand === band.key ? "active" : ""} onClick={() => setScoreBand(scoreBand === band.key ? "all" : band.key)} aria-pressed={scoreBand === band.key} aria-label={`${band.label} 分：${band.count} 条资料，其中已人工评估 ${band.reviewed} 条、待评估 ${band.pending} 条，点击筛选`}><span className="knowledge-score-band-count">{band.count}</span><span className="knowledge-score-band-track"><i style={{ width: `${records.length ? band.count / records.length * 100 : 0}%` }}><b style={{ width: `${band.count ? band.reviewed / band.count * 100 : 0}%` }} /></i></span><span className="knowledge-score-band-label">{band.label}</span><small className="knowledge-score-band-status">人工 {band.reviewed} · 待评 {band.pending}</small></button>)}</div>
            <div className="knowledge-score-band-legend" role="group" aria-label="按人工评估状态筛选评分分布"><button type="button" className={reviewFilter === "reviewed" ? "active" : ""} aria-pressed={reviewFilter === "reviewed"} onClick={() => setReviewFilter(reviewFilter === "reviewed" ? "all" : "reviewed")}><i className="reviewed" />已人工评估</button><button type="button" className={reviewFilter === "pending" ? "active" : ""} aria-pressed={reviewFilter === "pending"} onClick={() => setReviewFilter(reviewFilter === "pending" ? "all" : "pending")}><i />待人工评估</button></div>
          </div>
          <section className="knowledge-readiness" aria-label="资料审核准备度">
            <div className="knowledge-readiness-heading"><strong>审核准备度</strong><span>按流程状态筛选 · 不代表资料含金量</span></div>
            <div className="knowledge-readiness-grid">{readinessCounts.map((stage) => <button type="button" key={stage.key} className={`knowledge-readiness-item stage-${stage.key} ${readinessFilter === stage.key ? "active" : ""}`} onClick={() => setReadinessFilter(readinessFilter === stage.key ? "all" : stage.key)} aria-pressed={readinessFilter === stage.key} aria-label={`${stage.label} ${stage.count} 条：${stage.description}，点击筛选`} title={stage.description}><span>{stage.label}</span><strong>{stage.count}</strong><i><b style={{ width: `${records.length ? stage.count / records.length * 100 : 0}%` }} /></i></button>)}</div>
          </section>
          <div className="knowledge-evidence-coverage" role="group" aria-label="来源覆盖情况">
            {evidenceCoverage.map((item) => <button type="button" key={item.key} className={evidenceFilter === item.key ? "active" : ""} onClick={() => setEvidenceFilter(evidenceFilter === item.key ? "all" : item.key)} aria-pressed={evidenceFilter === item.key}><span>{item.label}</span><strong>{item.count}</strong><i><b style={{ width: `${records.length ? item.count / records.length * 100 : 0}%` }} /></i></button>)}
          </div>
        </section>
        <div className="knowledge-body">
          <aside className="knowledge-list">
            <label className="search-box knowledge-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、别名、领域或内容" /></label>
            <section className="knowledge-filter-assistant"><div className="knowledge-filter-assistant-title"><Sparkles size={13} /><strong>AI 自然语言筛选</strong><small>只发送筛选指令，不发送资料或简历</small></div><div className="knowledge-filter-assistant-input"><input value={filterInstruction} onChange={(event) => { setFilterInstruction(event.target.value); setFilterProposal(null); setFilterAssistantError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void proposeKnowledgeFilters(); } }} maxLength={500} placeholder="如：显示待补来源的竞赛" aria-label="描述要查找的资料" /><button type="button" onClick={() => void proposeKnowledgeFilters()} disabled={!agentAvailable || filterAssistantBusy || !filterInstruction.trim()} title={agentAvailable ? "生成筛选方案" : "请先配置模型服务"}>{filterAssistantBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}</button></div>{filterAssistantError && <div className="inline-error">{filterAssistantError}</div>}{filterProposal && <div className="knowledge-filter-proposal"><p>{filterProposal.rationale || "按以下条件筛选"}</p><div>{[filterProposal.kind === "all" ? "全部类别" : knowledgeKindLabels[filterProposal.kind], filterProposal.verificationFilter === "all" ? "全部核验状态" : filterProposal.verificationFilter === "verified" ? "已核验" : "待核验", filterProposal.reviewFilter === "all" ? "全部人工评估状态" : filterProposal.reviewFilter === "reviewed" ? "已有人工评估" : "待人工评估", filterProposal.readiness === "all" ? "全部审核准备度" : knowledgeReadinessStages.find((stage) => stage.key === filterProposal.readiness)?.label ?? "全部审核准备度", filterProposal.evidenceFilter === "all" ? "全部来源状态" : evidenceCoverage.find((item) => item.key === filterProposal.evidenceFilter)?.label ?? "全部来源状态", filterProposal.scoreBand === "all" ? "全部评分" : `${filterProposal.scoreBand} 分`, filterProposal.query ? `关键词：${filterProposal.query}` : "无关键词", filterProposal.linkedOnly ? "仅简历引用" : "不限简历引用", `排序：${({ default: "默认", score: "评分高低", updated: "最近更新", title: "名称" } as Record<KnowledgeSort, string>)[filterProposal.sort]}`].map((label) => <span key={label}>{label}</span>)}</div><small>预计匹配 {countFilterProposalMatches(filterProposal)} / {records.length} 条</small><footer><button type="button" onClick={() => setFilterProposal(null)}>放弃</button><button type="button" onClick={applyKnowledgeFilterProposal}>应用筛选</button></footer></div>}</section>
            <button className="add-knowledge-button" onClick={editorOpen ? closeEditor : beginCreate}>{editorOpen ? <X size={13} /> : <Plus size={13} />}{editorOpen ? "关闭编辑" : "新增资料"}</button>
            {editorOpen && <div className="knowledge-create-form">
              <strong>{editingId ? "编辑资料" : "新增资料"}</strong>
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="资料名称 *" />
              <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as KnowledgeKind })}>{(Object.keys(knowledgeKindLabels) as KnowledgeKind[]).map((key) => <option value={key} key={key}>{knowledgeKindLabels[key]}</option>)}</select>
              <p className="knowledge-manual-note">资料库仅支持人工维护；候选人的竞赛、论文和项目不会联网核查。</p>
              {enrichmentProposal && <section className="knowledge-enrichment-proposal"><div className="knowledge-enrichment-head"><strong>AI 草案 · 置信度 {Math.round(enrichmentProposal.confidence * 100)}%</strong><button type="button" onClick={() => setEnrichmentProposal(null)} aria-label="关闭 AI 整理草案"><X size={12} /></button></div><p>{enrichmentProposal.rationale}</p><dl><div><dt>别名</dt><dd>{enrichmentProposal.aliases.join("、") || "暂无可靠别名"}</dd></div><div><dt>领域 / 组织</dt><dd>{[enrichmentProposal.field, enrichmentProposal.organizer].filter(Boolean).join(" · ") || "待核验"}</dd></div><div><dt>地区</dt><dd>{enrichmentProposal.region || "待核验"}</dd></div><div><dt>简介</dt><dd>{enrichmentProposal.summary || "暂无足够资料"}</dd></div><div><dt>审核信号</dt><dd>{enrichmentProposal.signals.join("；") || "需人工补充"}</dd></div><div><dt>建议来源</dt><dd>{enrichmentProposal.officialUrl || "未找到可确认的来源链接"}</dd></div></dl>{enrichmentProposal.unknowns.length > 0 && <div className="knowledge-enrichment-unknown"><strong>待核实</strong><span>{enrichmentProposal.unknowns.join("；")}</span></div>}{enrichmentProposalStale && <div className="knowledge-enrichment-stale">资料名称、类别或内容已变化，请重新生成草案后再采用。</div>}<div className="knowledge-enrichment-sources"><strong>{enrichmentProposal.searchStatus === "searched" ? `联网线索 ${enrichmentProposal.sources.length} 条` : enrichmentProposal.searchStatus === "unavailable" ? "联网检索不可用" : enrichmentProposal.searchStatus === "not-configured" ? "未配置联网搜索" : "未找到网页线索"}</strong>{enrichmentProposal.sources.map((source) => <div className="knowledge-enrichment-source" key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={10} /></a>{source.snippet && <p>{source.snippet}</p>}</div>)}</div><div className="knowledge-enrichment-actions"><button type="button" disabled={enrichmentProposalStale} onClick={() => applyEnrichment(false)}>补全空白项</button><button type="button" disabled={enrichmentProposalStale} onClick={() => applyEnrichment(true)}>采用草案字段</button></div><small>只会更新当前编辑草稿；还需人工检查并保存。来源摘要不代表已经核实。</small></section>}
              <textarea value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} rows={2} placeholder="别名，每行一项" />
              <input value={draft.field} onChange={(event) => setDraft({ ...draft, field: event.target.value })} placeholder="所属领域" />
              <input value={draft.organizer} onChange={(event) => setDraft({ ...draft, organizer: event.target.value })} placeholder="主办方 / 组织" />
              <input value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} placeholder="地区" />
              <textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} rows={3} placeholder="简介与信息边界" />
              <textarea value={draft.signals} onChange={(event) => setDraft({ ...draft, signals: event.target.value })} rows={2} placeholder="人工审核信号，每行一项" />
              <input value={draft.officialUrl} onChange={(event) => setDraft({ ...draft, officialUrl: event.target.value })} placeholder="官方来源网址（可选）" />
               <section className="knowledge-evidence-editor"><div className="knowledge-evidence-editor-head"><strong>可追溯来源</strong><button type="button" onClick={addEvidenceSource} disabled={draft.evidenceSources.length >= 12}><Plus size={12} />添加来源</button></div>{draft.evidenceSources.map((source) => <div className="knowledge-evidence-edit-row" key={source.id}><div><input value={source.title} onChange={(event) => updateEvidenceSource(source.id, { title: event.target.value })} placeholder="来源名称 *" /><select value={source.sourceType} onChange={(event) => updateEvidenceSource(source.id, { sourceType: event.target.value as KnowledgeEvidenceSourceType })}>{Object.entries(knowledgeEvidenceSourceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={source.dataYear} onChange={(event) => updateEvidenceSource(source.id, { dataYear: event.target.value })} placeholder="数据年份" /></div><input value={source.url} onChange={(event) => updateEvidenceSource(source.id, { url: event.target.value })} placeholder="https://..." /><textarea value={source.note} onChange={(event) => updateEvidenceSource(source.id, { note: event.target.value })} rows={2} placeholder="这条来源能核实什么？" /><footer><label><input type="checkbox" checked={source.verified} onChange={(event) => updateEvidenceSource(source.id, { verified: event.target.checked, checkedAt: event.target.checked ? new Date().toISOString() : "" })} />我已人工核对</label><button type="button" onClick={() => setDraft((current) => ({ ...current, evidenceSources: current.evidenceSources.filter((item) => item.id !== source.id) }))} aria-label={`移除来源 ${source.title || "未命名"}`}><X size={12} /></button></footer></div>)}{draft.evidenceSources.length === 0 && <small>记录官网、学校认定文件、期刊目录或论文页面；来源核对状态由审核员维护。</small>}</section>
              {editorError && <div className="inline-error">{editorError}</div>}
              <button onClick={saveRecord} disabled={editorBusy || !draft.title.trim()}>{editorBusy ? "保存中" : editingId ? "保存修改" : "创建资料"}</button>
            </div>}
            <div className="knowledge-filters"><div className="knowledge-filter-buttons"><button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>全部</button>{(Object.keys(knowledgeKindLabels) as KnowledgeKind[]).map((key) => <button className={kind === key ? "active" : ""} key={key} onClick={() => setKind(key)}>{knowledgeKindLabels[key]}</button>)}</div><label className="knowledge-sort-label"><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as KnowledgeSort)} aria-label="资料排序"><option value="default">默认</option><option value="updated">最近更新</option><option value="score">评分高低</option><option value="title">名称</option></select></label></div>
            <div className="knowledge-secondary-filters"><div className="knowledge-filter-buttons"><button className={verificationFilter === "all" ? "active" : ""} onClick={() => setVerificationFilter("all")}>全部状态</button><button className={verificationFilter === "pending" ? "active" : ""} onClick={() => setVerificationFilter("pending")}>待核验</button><button className={verificationFilter === "verified" ? "active" : ""} onClick={() => setVerificationFilter("verified")}>已核验</button></div><button className={`linked-filter ${linkedOnly ? "active" : ""}`} onClick={() => setLinkedOnly((value) => !value)} aria-pressed={linkedOnly}>仅看已被简历引用</button></div>
            <div className="knowledge-result-count"><span>显示 {sortedRecords.length} / {records.length} 条{[kind !== "all" ? knowledgeKindLabels[kind] : "", query.trim() ? `关键词 ${query.trim()}` : "", scoreBand !== "all" ? `分数 ${scoreBand}` : "", evidenceFilter !== "all" ? evidenceCoverage.find((item) => item.key === evidenceFilter)?.label ?? "" : "", reviewFilter !== "all" ? reviewFilter === "reviewed" ? "已有人工评估" : "待人工评估" : "", verificationFilter !== "all" ? verificationFilter === "verified" ? "已核验" : "待核验" : "", readinessFilter !== "all" ? knowledgeReadinessStages.find((stage) => stage.key === readinessFilter)?.label ?? "" : "", linkedOnly ? "仅简历引用" : ""].filter(Boolean).map((item) => ` · ${item}`).join("")}</span>{(scoreBand !== "all" || query || kind !== "all" || verificationFilter !== "all" || evidenceFilter !== "all" || reviewFilter !== "all" || readinessFilter !== "all" || linkedOnly) && <button type="button" onClick={() => { setScoreBand("all"); setQuery(""); setKind("all"); setVerificationFilter("all"); setEvidenceFilter("all"); setReviewFilter("all"); setReadinessFilter("all"); setLinkedOnly(false); }}>清除筛选</button>}</div>
            <div className="knowledge-record-list">{sortedRecords.map((record) => <button className={`knowledge-record-row ${record.id === selected?.id ? "selected" : ""}`} key={record.id} onClick={() => setSelectedId(record.id)}><span className={`knowledge-kind-icon ${record.kind}`}><BookOpen size={15} /></span><span><strong>{record.title}</strong><small>{record.field || "未分类"} · {record.region || "地区待补充"} · {record.verificationStatus === "已核验" ? "已核验" : "待核验"}</small></span><span className="knowledge-row-links" title={`${linkedResumeCounts.get(record.id) ?? 0} 份简历引用`}>{linkedResumeCounts.get(record.id) ?? 0}<ExternalLink size={10} /></span><b>{record.significanceScore}</b></button>)}{!sortedRecords.length && <div className="empty-list">没有匹配资料</div>}</div>
          </aside>
          <section className="knowledge-detail">
            {selected ? <>
              <div className="knowledge-detail-head"><div><span className={`knowledge-type ${selected.kind}`}>{knowledgeKindLabels[selected.kind]}</span><h3>{selected.title}</h3><p>{selected.aliases.join(" · ") || "暂无别名"}</p></div><div className="knowledge-detail-controls"><strong className="knowledge-score">{selected.significanceScore}<small>/ 100</small></strong>{selected.id.startsWith("custom-") && <><button className="icon-button" onClick={beginEdit} title="编辑资料" aria-label="编辑资料"><Pencil size={15} /></button><button className="icon-button knowledge-delete-button" onClick={() => { setDeleteConfirmation(true); setDeleteError(""); }} title="删除本地资料" aria-label="删除本地资料"><Trash2 size={15} /></button></>}</div></div>
              {deleteConfirmation && <div className="knowledge-delete-confirm" role="alert"><div><strong>删除这条本地资料？</strong><span>{linkedResumeCounts.get(selected.id) ?? 0} 份简历将不再显示此资料的交叉引用，相关人工评估历史也会删除。</span>{deleteError && <small>{deleteError}</small>}</div><button type="button" onClick={() => setDeleteConfirmation(false)} disabled={deleteBusy}>取消</button><button type="button" onClick={() => void deleteSelectedRecord()} disabled={deleteBusy}>{deleteBusy ? "删除中" : "确认删除"}</button></div>}
              <div className="knowledge-meta"><span><b>领域</b>{selected.field || "未填写"}</span><span><b>组织 / 主办方</b>{selected.organizer || "未填写"}</span><span><b>地区</b>{selected.region || "未填写"}</span><span><b>核验状态</b>{selected.verificationStatus}</span></div>
              <p className="knowledge-summary">{selected.summary || "尚无简介，请编辑资料补充背景和信息边界。"}</p>
              <div className="knowledge-signals"><strong>审核信号</strong><div>{selected.signals.length ? selected.signals.map((signal) => <span key={signal}>{signal}</span>) : <small>尚未添加审核信号</small>}</div></div>
              <section className="knowledge-evidence-list"><div className="knowledge-evidence-list-head"><strong>可追溯来源</strong><span>{(selected.evidenceSources ?? []).filter((source) => source.verified).length} / {(selected.evidenceSources ?? []).length} 条已核对</span></div>{selected.officialUrl && <a className="knowledge-evidence-row" href={selected.officialUrl} target="_blank" rel="noreferrer"><span className="knowledge-evidence-status pending" /><span><strong>官方主页</strong><small>入口链接 · 尚未记录具体指标或认定条款</small></span><ExternalLink size={13} /></a>}{(selected.evidenceSources ?? []).map((source) => <a className="knowledge-evidence-row" key={source.id} href={source.url} target="_blank" rel="noreferrer"><span className={`knowledge-evidence-status ${source.verified ? "verified" : "pending"}`} /><span><strong>{source.title}<small>{[knowledgeEvidenceSourceTypeLabels[source.sourceType], source.dataYear].filter(Boolean).join(" · ")}{source.note ? ` · ${source.note}` : ""}</small></strong>{source.verified && source.checkedAt && <small>人工核对于 {new Date(source.checkedAt).toLocaleDateString("zh-CN")}</small>}</span><ExternalLink size={13} /></a>)}{!selected.officialUrl && !(selected.evidenceSources?.length) && <p className="knowledge-evidence-empty">暂无可追溯来源记录。</p>}</section>
              <div className="knowledge-referenced-resumes"><strong>被这些简历引用</strong>{referencedResumes.length ? referencedResumes.map(({ resume, match }) => <button key={resume.id} onClick={() => { onSelectEvidence(resume.id, match); onClose(); }} title={`返回简历并定位“${match}”`}><span className="candidate-avatar">{resume.initials}</span><span>{resume.name} · {resume.role}<small>原文命中：{match}</small></span><ExternalLink size={11} /></button>) : <span>当前简历正文中没有匹配的名称或别名</span>}</div>
              <div className="knowledge-review"><div className="review-heading"><div><span className="eyebrow">HUMAN REVIEW</span><h4>人工含金量评估</h4></div><span>仅保存审核员填写的评分</span></div>
                <label className="review-role">岗位背景<input value={roleContext} onChange={(event) => setRoleContext(event.target.value)} placeholder="例如：算法工程师、数据产品经理" /></label>
                <label className="review-focus">评估侧重（可选）<textarea value={reviewerFocus} onChange={(event) => setReviewerFocus(event.target.value)} maxLength={500} rows={2} placeholder="例如：优先看官方获奖名单与比赛规模，降低宣传性描述的权重" /><small>{reviewerFocus.length}/500</small></label>
                <p className="knowledge-manual-note">含金量评分仅支持人工填写，不会联网检索或核查候选人经历。</p>
                {reviewProposal && <div className="review-proposal"><div><strong>AI 建议 {reviewProposal.score}</strong><span>当前草稿 {reviewScore} · 差值 {reviewProposal.score - reviewScore > 0 ? "+" : ""}{reviewProposal.score - reviewScore}</span></div><p>{reviewProposal.rationale}</p><div className="review-proposal-actions"><button onClick={() => { setReviewScore(reviewProposal.score); setReviewNote(reviewProposal.rationale); setReviewSource("ai-assisted"); setReviewSaved(false); setReviewProposal(null); }}>采用建议</button><button onClick={() => setReviewProposal(null)}>保留当前</button></div></div>}
                <label>核验状态<select value={verificationStatus} onChange={(event) => { setVerificationStatus(event.target.value as KnowledgeRecord["verificationStatus"]); setReviewSource("manual"); setReviewSaved(false); }}><option value="示例资料，待核验">待核验</option><option value="已核验">已核验</option></select></label>
                <label>评分 <output>{reviewScore}</output><input type="range" min="0" max="100" value={reviewScore} onChange={(event) => { setReviewScore(Number(event.target.value)); setReviewSource("manual"); setReviewSaved(false); }} /></label>
                <textarea value={reviewNote} onChange={(event) => { setReviewNote(event.target.value); setReviewSource("manual"); setReviewSaved(false); }} rows={4} placeholder="说明评分依据、岗位相关性和待核验事项" />
                {(selected.evidenceSources?.length ?? 0) > 0 && <fieldset className="review-evidence-citations"><legend>本次评分引用</legend>{selected.evidenceSources!.map((source) => <label key={source.id}><input type="checkbox" checked={reviewSourceIds.includes(source.id)} onChange={(event) => setReviewSourceIds((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} /><span>{source.title}<small>{knowledgeEvidenceSourceTypeLabels[source.sourceType]} · {source.verified ? "已人工核对" : "待核对"}</small></span></label>)}</fieldset>}
                {reviewSource === "ai-assisted" && <span className="review-source-note">当前草稿采用 AI 建议；点击保存后会记为经人工确认。</span>}
                {suggestionQuestions.length > 0 && <div className="verification-questions"><strong>建议核实</strong>{suggestionQuestions.map((item) => <span key={item}>{item}</span>)}</div>}
                {reviewError && <div className="inline-error">{reviewError}</div>}{reviewSaved && <div className="review-saved">人工评估已保存</div>}
                <button className="save-review" onClick={saveReview} disabled={saving}>{saving ? "保存中" : "保存人工评估"}</button>
              </div>
              <KnowledgeReviewHistory key={selected.id} history={selected.reviewHistory ?? []} sources={selected.evidenceSources ?? []} />
              {selected.officialUrl && <a className="official-link" href={selected.officialUrl} target="_blank" rel="noreferrer">打开官方来源 <ExternalLink size={14} /></a>}
            </> : <div className="knowledge-empty-detail">没有符合筛选条件的资料。</div>}
          </section>
        </div>
      </div>
    </main>
  );
}

function depthScore(card: ScoreCard): number {
  const keys: ScoreKey[] = ["leadership", "expertise", "experience", "roleFit", "growth"];
  return Math.round(keys.reduce((total, key) => total + actualScore(card.criteria[key].score), 0) / keys.length * 10) / 10;
}

function comparisonAxisScore(card: ScoreCard, axis: ComparisonMapAxis): number {
  return axis === "depth" ? depthScore(card) : boundedScore(card.criteria[axis].score);
}

function matchesMapRegion(card: ScoreCard, mapX: ComparisonMapAxis, mapY: ComparisonMapAxis, region: ComparisonMapRegion, threshold: number): boolean {
  return matchesComparisonMapRegion(comparisonAxisScore(card, mapX), comparisonAxisScore(card, mapY), region, threshold);
}

const mapRegionLabels: Record<Exclude<ComparisonMapRegion, "all">, string> = {
  "high-high": "横高 · 纵高",
  "high-low": "横高 · 纵低",
  "low-high": "横低 · 纵高",
  "low-low": "横低 · 纵低",
};
const mapQuadrantColorClasses: Record<Exclude<ComparisonMapRegion, "all">, string> = {
  "low-high": "learning",
  "high-high": "deep",
  "low-low": "narrow",
  "high-low": "broad",
};

function RecruitmentQualityMap({ candidates, selectedId, onSelect, rankLabel, rankDirection, mapX, mapY, mapRegion, mapThreshold, onRegionChange, mapLabels }: { candidates: Array<{ resume: Resume; card: ScoreCard }>; selectedId: string; onSelect: (id: string) => void; rankLabel: string; rankDirection: "asc" | "desc"; mapX: ComparisonRankDraft["mapX"]; mapY: ComparisonRankDraft["mapY"]; mapRegion: ComparisonMapRegion; mapThreshold: number; onRegionChange: (region: ComparisonMapRegion) => void; mapLabels: Record<ComparisonRankDraft["mapX"], string> }) {
  const width = 620;
  const height = 320;
  const left = 56;
  const right = 24;
  const top = 28;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const axisValue = comparisonAxisScore;
  const pointX = (value: number) => left + (value / 100) * plotWidth;
  const pointY = (value: number) => top + plotHeight - (value / 100) * plotHeight;
  const xName = mapLabels[mapX];
  const yName = mapLabels[mapY];
  const regionCount = candidates.filter(({ card }) => matchesMapRegion(card, mapX, mapY, mapRegion, mapThreshold)).length;
  const thresholdX = left + plotWidth * mapThreshold / 100;
  const thresholdY = top + plotHeight * (1 - mapThreshold / 100);
  const quadrants = comparisonMapQuadrants(left, top, plotWidth, plotHeight, mapThreshold);
  const mapCandidates = [...candidates.filter(({ resume }) => resume.id !== selectedId), ...candidates.filter(({ resume }) => resume.id === selectedId)];
  return <section className="quality-map-section">
    <div className="quality-map-head"><div><span className="eyebrow">RECRUITING QUALITY MAP</span><h3>招聘质量图 · {yName} × {xName}</h3><p>坐标轴反映不同能力维度；点内序号对应当前排名，选中时显示姓名。</p></div><div className="quality-map-legend"><span className="quality-size-legend"><i className="quality-size-small" />50 分</span><span className="quality-size-legend"><i className="quality-size-large" />100 分</span><span className="quality-rank-context">气泡半径 = 综合分</span><span className="quality-rank-context">{rankLabel} · {rankDirection === "desc" ? "高分优先" : "低分优先"}</span></div></div>
    <div className="quality-map-wrap"><svg className="quality-map" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`招聘质量图，横轴${xName}，纵轴${yName}，点序号按${rankLabel}${rankDirection === "desc" ? "高分优先" : "低分优先"}`}>
      <rect x={left} y={top} width={plotWidth} height={plotHeight} className="quality-map-bg" />
      {quadrants.map(({ key, x, y, width: regionWidth, height: regionHeight }) => <g key={key} className={`quality-map-region ${mapRegion === key ? "active" : ""}`} role="button" tabIndex={0} aria-label={`筛选象限：${mapRegionLabels[key]}，阈值 ${mapThreshold}`} aria-pressed={mapRegion === key} onClick={() => onRegionChange(mapRegion === key ? "all" : key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRegionChange(mapRegion === key ? "all" : key); } }}><rect x={x} y={y} width={regionWidth} height={regionHeight} className={`quality-quadrant quality-quadrant-${mapQuadrantColorClasses[key]}`} /><title>{`点击筛选${mapRegionLabels[key]}候选人，阈值 ${mapThreshold}`}</title></g>)}
      <line x1={thresholdX} y1={top} x2={thresholdX} y2={top + plotHeight} className="quality-midline" /><line x1={left} y1={thresholdY} x2={left + plotWidth} y2={thresholdY} className="quality-midline" /><line x1={left} y1={top + plotHeight} x2={left + plotWidth} y2={top + plotHeight} className="quality-axis" /><line x1={left} y1={top} x2={left} y2={top + plotHeight} className="quality-axis" />
      {quadrants.map(({ key, centerX, centerY }) => <text key={key} x={centerX} y={centerY + 3} textAnchor="middle" className="quality-quadrant-label">{mapRegionLabels[key]}</text>)}
      {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={pointX(tick)} y1={top + plotHeight} x2={pointX(tick)} y2={top + plotHeight + 4} className="quality-axis" /><text x={pointX(tick)} y={height - 25} textAnchor="middle" className="quality-tick">{tick}</text><line x1={left - 4} y1={pointY(tick)} x2={left} y2={pointY(tick)} className="quality-axis" /><text x={left - 9} y={pointY(tick) + 3} textAnchor="end" className="quality-tick">{tick}</text></g>)}
      {mapCandidates.map(({ resume, card }) => { const index = candidates.findIndex((candidate) => candidate.resume.id === resume.id); const xValue = axisValue(card, mapX); const yValue = axisValue(card, mapY); const composite = actualScore(card.composite); const radius = 5 + boundedScore(composite) / 10; const x = pointX(xValue); const y = pointY(yValue); const active = resume.id === selectedId; const stableColor = [...resume.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4 + 1; const label = resume.name.length > 8 ? `${resume.name.slice(0, 8)}…` : resume.name; return <g key={resume.id} className={`quality-point ${active ? "selected" : ""}`} role="button" tabIndex={0} aria-pressed={active} aria-label={`排名第 ${index + 1}：${resume.name}，${xName} ${xValue.toFixed(0)}，${yName} ${yValue.toFixed(0)}，${rankLabel}${rankDirection === "desc" ? "高分优先" : "低分优先"}，综合分 ${composite.toFixed(1)}`} onClick={() => onSelect(resume.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(resume.id); } }}><title>{`第 ${index + 1} 名 · ${resume.name} · ${xName} ${xValue.toFixed(0)} · ${yName} ${yValue.toFixed(0)} · 综合分 ${composite.toFixed(1)}`}</title><circle cx={x} cy={y} r={active ? radius + 2 : radius} className={`quality-bubble quality-bubble-${stableColor}`} /><text x={x} y={y + 3} textAnchor="middle" className="quality-rank-mark">{index + 1}</text>{active && <text x={x} y={y - radius - 7} textAnchor="middle" className="quality-name">{label}</text>}</g>; })}
      <text x={left + plotWidth / 2} y={height - 7} textAnchor="middle" className="quality-axis-label">{xName}</text><text x="14" y={top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 14 ${top + plotHeight / 2})`} className="quality-axis-label">{yName}</text>
    </svg></div><div className="quality-map-note"><span>{mapRegion === "all" ? `点击象限联动筛选排名表；横纵轴阈值均为 ${mapThreshold}` : `象限筛选：${mapRegionLabels[mapRegion]} · ${regionCount} 位候选人 · 阈值 ${mapThreshold}`}</span><span>能力深度取领导力、专业能力、经验、岗位契合度和进步分的平均值</span><span>气泡半径映射综合分；重叠候选人可在下方排名表点选</span></div>
  </section>;
}


function ComparisonPreview({ candidate, card, view, knowledgeRecords }: { candidate: Resume; card: ScoreCard; view: "resume" | "analysis"; knowledgeRecords: KnowledgeRecord[] }) {
  if (view === "resume") {
    return <div className="comparison-preview-body">{candidate.source === "pdf" ? <PdfReader key={candidate.id} url={`/api/resumes/${encodeURIComponent(candidate.id)}/file`} title={candidate.fileName ?? `${candidate.name}.pdf`} evidenceTarget="" knowledgeRecords={knowledgeRecords} onEvidenceResult={() => undefined} /> : <article className="comparison-sample-page"><div className="sample-document-label"><span>BOHACK SAMPLE</span><span>候选人简历</span></div><h3>{candidate.name}</h3><p className="comparison-sample-role">{candidate.role} · {candidate.location}</p><section><h4>个人概览</h4><p>{candidate.summary || candidate.text.split("。")[0]}</p></section><section><h4>工作 / 项目经历</h4>{(candidate.experiences ?? []).map((experience) => <article key={`${experience.company}-${experience.period}`}><strong>{experience.role}</strong><span>{experience.company} · {experience.period}</span><p>{experience.detail}</p></article>)}</section><section><h4>教育与技能</h4><p>{candidate.education}</p><div className="comparison-sample-skills">{candidate.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></section></article>}</div>;
  }
  const report = candidate.analysisReport?.trim() || "这份候选人还没有生成分析报告。返回工作台后可重新运行 Agent。";
  const composite = actualScore(card.composite);
  return <div className="comparison-preview-body comparison-analysis-preview"><article className="comparison-analysis-paper"><div className="analysis-paper-head"><span>BOHACK / CANDIDATE REVIEW</span><span>分析文档</span></div><h3>{candidate.name} · 分析报告</h3><p className={`analysis-paper-subtitle ${composite >= 100 ? "score-at-limit" : ""}`}>{candidate.role} · 综合分 {composite.toFixed(1)}</p><div className="comparison-preview-score-grid">{scoreCriteria.map(({ key, label }) => { const score = actualScore(card.criteria[key].score); return <div key={key}><span>{label}</span><strong className={score >= 100 ? "score-at-limit" : ""}>{score.toFixed(0)}</strong></div>; })}</div><div className="comparison-analysis-text">{report}</div><small className="analysis-paper-foot">分析结果仅作招聘决策参考 · 需要招聘人员复核</small></article></div>;
}

function ComparisonView({ resumes, weights, selectedId, onSelectResume, onEvidence, onClose, agentAvailable, knowledgeRecords, onDecision, decisionBusy, decisionError }: { resumes: Resume[]; weights: ScoreWeights; selectedId: string; onSelectResume: (id: string) => void; onEvidence: (evidence: string) => void; onClose: () => void; agentAvailable: boolean; knowledgeRecords: KnowledgeRecord[]; onDecision: (id: string, decision: Exclude<ResumeDecision, "pending">) => void; decisionBusy: boolean; decisionError: string }) {
  const [rankCriterion, setRankCriterion] = useState<ComparisonRankCriterion>("composite");
  const [rankDirection, setRankDirection] = useState<ComparisonRankDraft["direction"]>("desc");
  const [mapX, setMapX] = useState<ComparisonMapAxis>("perspective");
  const [mapY, setMapY] = useState<ComparisonMapAxis>("depth");
  const [mapRegion, setMapRegion] = useState<ComparisonMapRegion>("all");
  const [mapThreshold, setMapThreshold] = useState(50);
  const [ratingFilter, setRatingFilter] = useState<ComparisonRatingFilter>("all");
  const [rankInstruction, setRankInstruction] = useState("");
  const [rankProposal, setRankProposal] = useState<ComparisonRankDraft | null>(null);
  const [rankBusy, setRankBusy] = useState(false);
  const [rankError, setRankError] = useState("");
  const [focusEvidenceKey, setFocusEvidenceKey] = useState<ScoreKey | null>(null);
  const [previewView, setPreviewView] = useState<"resume" | "analysis">("resume");
  const [previewOpen, setPreviewOpen] = useState(true);
  const evidenceCardRefs = useRef(new Map<ScoreKey, HTMLElement>());
  const allRanked = useMemo(() => resumes.map((resume, index) => ({ resume, card: comparisonScoreCard(resume, index, weights) })).sort((left, right) => {
    const leftScore = rankCriterion === "composite" ? left.card.composite : left.card.criteria[rankCriterion].score;
    const rightScore = rankCriterion === "composite" ? right.card.composite : right.card.criteria[rankCriterion].score;
    const primary = rankDirection === "desc" ? rightScore - leftScore : leftScore - rightScore;
    return primary || right.card.composite - left.card.composite || left.resume.name.localeCompare(right.resume.name, "zh-CN");
  }), [resumes, weights, rankCriterion, rankDirection]);
  const sourceFiltered = useMemo(() => allRanked.filter(({ resume }) => ratingFilter === "all" || (ratingFilter === "scored" ? hasAgentScore(resume) : !hasAgentScore(resume))), [allRanked, ratingFilter]);
  const ranked = useMemo(() => sourceFiltered.filter(({ card }) => matchesMapRegion(card, mapX, mapY, mapRegion, mapThreshold)), [sourceFiltered, mapX, mapY, mapRegion, mapThreshold]);
  useEffect(() => {
    if (ranked.length && !ranked.some(({ resume }) => resume.id === selectedId)) onSelectResume(ranked[0].resume.id);
  }, [ranked, selectedId, onSelectResume]);
  const selected = ranked.find(({ resume }) => resume.id === selectedId) ?? ranked[0];
  const selectedDecision = selected?.resume.reviewStatus ?? "pending";
  useEffect(() => {
    if (!focusEvidenceKey || !selected) return;
    const target = evidenceCardRefs.current.get(focusEvidenceKey);
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    target?.focus({ preventScroll: true });
  }, [focusEvidenceKey, selected?.resume.id]);
  const rankLabels: Record<ComparisonRankCriterion, string> = { composite: "综合分", ...Object.fromEntries(scoreCriteria.map(({ key, label }) => [key, label])) } as Record<ComparisonRankCriterion, string>;
  const mapLabels: Record<ComparisonMapAxis, string> = { ...rankLabels, depth: "能力深度（五项均值）" };
  const ratingFilterLabels: Record<ComparisonRatingFilter, string> = { all: "全部", scored: "已生成评分卡", demo: "演示 / 待评分" };

  async function suggestRanking() {
    setRankBusy(true); setRankError(""); setRankProposal(null);
    try {
      const response = await fetch("/api/resumes/comparison/rank-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: rankInstruction, current: { criterion: rankCriterion, direction: rankDirection, ratingFilter, mapX, mapY, mapRegion, mapThreshold } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法生成排名方案。");
      setRankProposal(payload.suggestion as ComparisonRankDraft);
    } catch (error) { setRankError(error instanceof Error ? error.message : "无法生成排名方案。"); }
    finally { setRankBusy(false); }
  }

  return <main className="comparison-main comparison-workspace-main"><div className={`comparison-layout ${previewOpen ? "" : "preview-closed"}`}>{previewOpen && <aside className="comparison-preview"><div className="comparison-preview-head"><div><span className="eyebrow">SELECTED CANDIDATE</span><h2>{selected?.resume.name ?? "未选择候选人"}</h2><p>{selected?.resume.role ?? "请从右侧排名选择候选人"}</p></div><div className="comparison-preview-head-actions"><div className="comparison-view-switch" role="tablist" aria-label="切换候选人简历或分析文档"><button type="button" className={previewView === "resume" ? "active" : ""} role="tab" aria-selected={previewView === "resume"} onClick={() => setPreviewView("resume")}><ArrowLeft size={12} />简历</button><button type="button" className={previewView === "analysis" ? "active" : ""} role="tab" aria-selected={previewView === "analysis"} onClick={() => setPreviewView("analysis")}>分析文档<ArrowRight size={12} /></button></div><button type="button" className="comparison-preview-close" onClick={() => setPreviewOpen(false)} title="关闭候选人预览，恢复全图视野" aria-label="关闭候选人预览"><X size={14} /></button></div></div>{selected ? <><ComparisonPreview candidate={selected.resume} card={selected.card} view={previewView} knowledgeRecords={knowledgeRecords} /><div className="comparison-decision-actions" aria-label="候选人初筛决定"><span>初筛结果</span><button type="button" className={`decision-button pass ${selectedDecision === "passed" ? "active" : ""}`} onClick={() => onDecision(selected.resume.id, "passed")} disabled={decisionBusy} title="标记为通过初筛">{selectedDecision === "passed" ? "已通过" : "通过"}</button><button type="button" className={`decision-button reject ${selectedDecision === "rejected" ? "active" : ""}`} onClick={() => onDecision(selected.resume.id, "rejected")} disabled={decisionBusy} title="标记为拒绝">{selectedDecision === "rejected" ? "已拒绝" : "拒绝"}</button></div>{decisionError && <div className="decision-error comparison-decision-error">{decisionError}</div>}</> : <div className="comparison-preview-empty">请从右侧排名选择候选人</div>}</aside>}<div className="comparison-panel">
    <div className="comparison-head"><div><span className="eyebrow">CANDIDATE COMPARISON</span><h2>多人候选人对比</h2></div><div className="comparison-head-actions">{!previewOpen && <button className="comparison-show-preview" type="button" onClick={() => setPreviewOpen(true)}><FileText size={13} />显示候选人预览</button>}<span className="comparison-count">显示 {ranked.length} / {resumes.length} 位</span><button className="back-to-workspace" onClick={onClose}><span>返回分析</span></button></div></div>
      <div className="comparison-source-filter" role="group" aria-label="按评分来源筛选候选人"><span>评分来源</span>{(["all", "scored", "demo"] as ComparisonRatingFilter[]).map((filterKey) => { const count = filterKey === "all" ? resumes.length : resumes.filter((resume) => filterKey === "scored" ? hasAgentScore(resume) : !hasAgentScore(resume)).length; return <button key={filterKey} type="button" className={ratingFilter === filterKey ? "active" : ""} aria-pressed={ratingFilter === filterKey} onClick={() => setRatingFilter(filterKey)}>{ratingFilterLabels[filterKey]}<b>{count}</b></button>; })}</div>
    <section className="comparison-rank-tools" aria-label="设置候选人排名依据">
      <label>排名依据<select value={rankCriterion} onChange={(event) => setRankCriterion(event.target.value as ComparisonRankCriterion)}><option value="composite">综合分</option>{scoreCriteria.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>顺序<select value={rankDirection} onChange={(event) => setRankDirection(event.target.value as ComparisonRankDraft["direction"])}><option value="desc">高分优先</option><option value="asc">低分优先</option></select></label>
      <label>图表横轴<select value={mapX} onChange={(event) => { const next = event.target.value as ComparisonMapAxis; setMapX(next); if (next === mapY) setMapY(mapX); }}>{scoreCriteria.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}<option value="depth">能力深度（五项均值）</option></select></label>
      <label>图表纵轴<select value={mapY} onChange={(event) => { const next = event.target.value as ComparisonMapAxis; setMapY(next); if (next === mapX) setMapX(mapY); }}>{scoreCriteria.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}<option value="depth">能力深度（五项均值）</option></select></label>
      <label className="comparison-threshold-control">象限分界 <input type="range" min="20" max="80" step="5" value={mapThreshold} onChange={(event) => setMapThreshold(Number(event.target.value))} /><output>{mapThreshold}</output></label>
      <div className="comparison-rank-assistant"><input value={rankInstruction} onChange={(event) => { setRankInstruction(event.target.value); setRankProposal(null); setRankError(""); }} maxLength={500} placeholder="如：只看真实评分，按专业能力降序；图表对比经验与岗位契合度" aria-label="描述候选人筛选、排名和图表维度" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void suggestRanking(); } }} /><button type="button" onClick={() => void suggestRanking()} disabled={!agentAvailable || rankBusy || !rankInstruction.trim()} title={agentAvailable ? "生成筛选、排名与图表方案" : "请先配置模型服务"}>{rankBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}AI 建议</button>
      </div>
      {rankError && <span className="comparison-rank-error">{rankError}</span>}
      {rankProposal && <div className="comparison-rank-proposal"><span>{rankProposal.rationale}</span><strong>{ratingFilterLabels[rankProposal.ratingFilter]} · 排名按{rankLabels[rankProposal.criterion]}{rankProposal.direction === "desc" ? "高分优先" : "低分优先"} · 图表 {mapLabels[rankProposal.mapY]} × {mapLabels[rankProposal.mapX]} · 分界 {rankProposal.mapThreshold} · {rankProposal.mapRegion === "all" ? "全部象限" : mapRegionLabels[rankProposal.mapRegion]}</strong><div><button type="button" onClick={() => setRankProposal(null)}>放弃</button><button type="button" onClick={() => { setRankCriterion(rankProposal.criterion); setRankDirection(rankProposal.direction); setRatingFilter(rankProposal.ratingFilter); setMapX(rankProposal.mapX); setMapY(rankProposal.mapY); setMapRegion(rankProposal.mapRegion); setMapThreshold(rankProposal.mapThreshold); setRankProposal(null); }}>应用方案</button></div></div>}
    </section>
    {mapRegion !== "all" && <div className="comparison-region-filter"><span>图表象限：{mapRegionLabels[mapRegion]} · {ranked.length} 位</span><button type="button" onClick={() => setMapRegion("all")}>显示全部</button></div>}
    {sourceFiltered.length ? <RecruitmentQualityMap candidates={sourceFiltered} selectedId={selected?.resume.id ?? ""} onSelect={onSelectResume} rankLabel={rankLabels[rankCriterion]} rankDirection={rankDirection} mapX={mapX} mapY={mapY} mapRegion={mapRegion} mapThreshold={mapThreshold} onRegionChange={setMapRegion} mapLabels={mapLabels} /> : <div className="comparison-empty">当前筛选下没有候选人。可切换评分来源查看其他档案。</div>}
     <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>排名</th><th>候选人</th>{scoreCriteria.map(({ key, label }) => <th key={key}>{label}</th>)}<th>综合分</th></tr></thead><tbody>{ranked.length ? ranked.map(({ resume, card }, rank) => { const reviewStatus = resume.reviewStatus ?? "pending"; return <tr key={resume.id} className={`${resume.id === selected?.resume.id ? "selected " : ""}${reviewStatus === "passed" ? "review-passed" : reviewStatus === "rejected" ? "review-rejected" : ""}`} aria-selected={resume.id === selected?.resume.id}><td><span className={`rank-badge rank-${rank + 1}`}>{rank + 1}</span></td><td><button className="comparison-candidate-select" onClick={() => { onSelectResume(resume.id); setFocusEvidenceKey(null); }} aria-pressed={resume.id === selected?.resume.id}><strong>{resume.name}{reviewStatus !== "pending" && <span className={`comparison-review-badge ${reviewStatus}`}>{reviewStatus === "passed" ? "已通过初筛" : "已拒绝"}</span>}</strong><small>{resume.role} · {hasAgentScore(resume) ? "Agent 评分" : "演示 / 待评分"}</small></button></td>{scoreCriteria.map(({ key, label }) => { const criterion = card.criteria[key]; const score = actualScore(criterion.score); const visualScore = boundedScore(score); const atLimit = score >= 100; return <td className="score-cell" key={key}><button type="button" className="comparison-score-evidence" onClick={() => { onSelectResume(resume.id); setFocusEvidenceKey(key); }} title={`查看 ${resume.name} · ${label} 的评分依据`} aria-label={`${resume.name}，${label} ${score.toFixed(0)} 分${atLimit ? "（视觉条形已到上限）" : ""}，查看评分依据`}><span className="score-cell-score"><span className={`score-cell-value ${atLimit ? "score-at-limit" : ""}`}>{score.toFixed(0)}</span><i className={atLimit ? "at-limit" : ""}><b style={{ width: `${visualScore}%` }} /></i></span></button></td>; })}<td className={`composite-cell ${card.composite >= 100 ? "score-at-limit" : ""}`}>{actualScore(card.composite).toFixed(1)}</td></tr>; }) : <tr><td colSpan={9} className="comparison-empty-cell">当前筛选下没有候选人。</td></tr>}</tbody></table></div>
     {selected && <section className="comparison-evidence"><div className="comparison-evidence-head"><div><span className="eyebrow">SELECTED CANDIDATE</span><h3>{selected.resume.name} · {selected.resume.role}</h3><p>{rankLabels[rankCriterion]}排名 {ranked.findIndex(({ resume }) => resume.id === selected.resume.id) + 1} · 综合分 <strong className={actualScore(selected.card.composite) >= 100 ? "score-at-limit" : ""}>{actualScore(selected.card.composite).toFixed(1)}</strong> · 深度 {depthScore(selected.card).toFixed(1)} · 广度 {actualScore(selected.card.criteria.perspective.score).toFixed(0)}</p></div><button className="back-to-workspace" onClick={() => { onSelectResume(selected.resume.id); onClose(); }}>打开简历分析</button></div><div className="comparison-evidence-grid">{scoreCriteria.map(({ key, label }) => { const criterion = selected.card.criteria[key]; const score = actualScore(criterion.score); return <article key={key} className={focusEvidenceKey === key ? "focused" : ""} ref={(element) => { if (element) evidenceCardRefs.current.set(key, element); else evidenceCardRefs.current.delete(key); }} tabIndex={-1}><div className="comparison-evidence-metric"><span><strong>{label}</strong></span><b className={score >= 100 ? "score-at-limit" : ""}>{score.toFixed(0)}</b></div>{criterion.evidence.length ? criterion.evidence.slice(0, 2).map((evidence, index) => <button className="comparison-evidence-link" key={`${index}-${evidence}`} onClick={() => { onSelectResume(selected.resume.id); onEvidence(evidence); onClose(); }} title="回到 PDF 定位依据">{evidence}<ExternalLink size={10} /></button>) : <p>暂无可展示的证据摘要</p>}</article>; })}</div></section>}
    <div className="weight-summary"><span>当前权重</span>{scoreCriteria.map(({ key, label }) => <span key={key}>{label} {weights[key]}%</span>)}</div>
  </div></div></main>;
}


function ComparisonSelectedSidebar({ candidate, weights, index }: { candidate: Resume; weights: ScoreWeights; index: number }) {
  const card = comparisonScoreCard(candidate, index, weights);
  const composite = actualScore(card.composite);
  return <section className="comparison-selected-sidebar" aria-label="当前选中候选人分数">
    <div className="comparison-selected-sidebar-head"><div><span className="eyebrow">SELECTED CANDIDATE</span><h3>{candidate.name}</h3><p>{candidate.role} · {candidate.location}</p></div><strong className={composite >= 100 ? "score-at-limit" : ""}>{composite.toFixed(1)}</strong></div>
    <div className="comparison-selected-sidebar-total"><span>当前综合分</span><small>按右侧岗位权重计算</small></div>
    <div className="comparison-selected-sidebar-grid">{scoreCriteria.map(({ key, label }) => <div key={key}><span>{label}</span><b className={actualScore(card.criteria[key].score) >= 100 ? "score-at-limit" : ""}>{actualScore(card.criteria[key].score).toFixed(0)}</b></div>)}</div>
  </section>;
}

function AnalysisDocument({ answer, sections, busy, error, candidate, roleRequirements, scoreCard, knowledgeRecords, historyCandidates, onOpenKnowledge, onOpenHistory, onOpenScoring, agentAvailable, onEvidence }: { answer: string; sections: AnalysisSection[]; busy: boolean; error: string; candidate: Resume; roleRequirements: string; scoreCard: ScoreCard; knowledgeRecords: KnowledgeRecord[]; historyCandidates: HistoricalCandidate[]; onOpenKnowledge: (id?: string) => void; onOpenHistory: (roleGroup: string, year: number | null, selectedId?: string) => void; onOpenScoring: () => void; agentAvailable: boolean; onEvidence: (evidence: string) => void }) {
  const pages = sections.length ? sections.map((section) => section.markdown) : paginateReport(answer);
  // Keep every chart on the same score source. Once the material Agent has
  // returned an assessment, the trend and peer comparison must not fall back
  // to the demo score card while the radar uses live data.
  const visualScoreCard = candidate.assessment ? scoreCardFromAssessment(candidate.assessment, scoreCard) : scoreCard;
  return (
    <div className="analysis-document-shell">
      <div className="analysis-document-toolbar">
        <div className="document-tab"><FileText size={15} /><span>分析报告.pdf</span></div>
        <span className="analysis-document-meta">{answer || sections.length ? `${pages.length} 页` : "待生成"}</span>
      </div>
      <div className="analysis-document-pages">
        {error && answer && <div className="inline-error" role="alert">{error}</div>}
        <section className="analysis-visuals-top" aria-label="核心评分图表">
          <div className="analysis-visual-card analysis-radar-top">
            <div className="analysis-visual-card-head"><span className="eyebrow">CORE ABILITY PROFILE</span><strong>核心能力雷达图</strong><small>{candidate.assessment ? "当前 Agent 评分结果" : "当前评分卡"}</small></div>
            {candidate.assessment ? <MaterialAssessmentRadar assessment={candidate.assessment} /> : <ScoreRadar card={scoreCard} selectedKey={null} onSelect={() => undefined} />}
          </div>
          <div className="analysis-visual-card"><ScoreTrend card={visualScoreCard} candidate={candidate} /></div>
          <div className="analysis-visual-card"><BenchmarkBadge role={candidate.role} score={actualScore(visualScoreCard.composite)} candidates={historyCandidates} onOpenHistory={onOpenHistory} /></div>
        </section>
        {busy && !answer && !sections.length ? <div className="analysis-paper analysis-paper-state"><span className="working-mark"><Sparkles size={18} /></span><strong>正在生成分析文档</strong><p>Agent 正在逐项整理简历证据、岗位匹配和项目拆解。</p><div className="loading-line"><i /></div></div> : error && !answer && !sections.length ? <div className="analysis-paper analysis-paper-state error-paper"><strong>分析文档生成失败</strong><p>{error}</p></div> : (answer || sections.length) ? pages.map((page, index) => <article className="analysis-paper" key={`${candidate.id}-${index}`}><div className="analysis-paper-head"><span>简阅 / 候选人评阅</span><span>{String(index + 1).padStart(2, "0")}</span></div><h3>{candidate.name} · {sections[index]?.label || "简历分析"}</h3><p className="analysis-paper-subtitle">{candidate.role} · {roleRequirements ? "已对照职位要求" : "职位要求待补充"}</p><div className="analysis-paper-body analysis-markdown">{renderMarkdown(page)}</div><div className="analysis-paper-foot">第 {index + 1} 页 / {pages.length}</div></article>) : <div className="analysis-paper analysis-paper-state"><span className="empty-result-icon"><Sparkles size={18} /></span><strong>等待生成分析文档</strong><p>填写职位要求并开始分析，右侧会生成一份可滚动阅读的分析文档。</p></div>}
        {candidate.assessment ? <>
          <details className="analysis-score-detail-card">
            <summary><span><strong>详细计分分析</strong><small>{candidate.assessment.materials.length} 项材料 · 能力贡献、因素分解与原文依据</small></span><ChevronDown size={16} /></summary>
            <MaterialAssessment assessment={candidate.assessment} history={candidate.assessmentHistory} onEvidence={onEvidence} />
          </details>
        </> : <>
          <div className="analysis-score-summary-actions analysis-score-summary-empty">
            <div><span className="eyebrow">MATERIAL SCORING V1</span><strong>材料评分尚未生成</strong><small>生成后将在分析文档中展示新的雷达图、材料分和能力分。</small></div>
            <button type="button" onClick={onOpenScoring}>进入评分详情 <ArrowRight size={13} /></button>
          </div>
          <details className="score-history-details"><summary>查看历史评分记录</summary><p className="contribution-note">这部分数据用于查看已有档案记录，不参与材料评分 v1 的当前排序。</p><ScoreInsights card={scoreCard} candidate={candidate} records={knowledgeRecords} historyCandidates={historyCandidates} onOpenKnowledge={onOpenKnowledge} onOpenHistory={onOpenHistory} agentAvailable={agentAvailable} onEvidence={onEvidence} /></details>
        </>}
      </div>
    </div>
  );
}

function paginateReport(answer: string): string[] {
  if (!answer) return [""];
  const paragraphs = answer.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index];
    if (/^#{1,6}\s/.test(current) && paragraphs[index + 1]) {
      blocks.push(`${current}\n\n${paragraphs[index + 1]}`);
      index += 1;
    } else {
      blocks.push(current);
    }
  }
  const pages: string[] = [];
  let pageBlocks: string[] = [];
  let pageLength = 0;

  for (const block of blocks) {
    const separatorLength = pageBlocks.length ? 2 : 0;
    if (pageBlocks.length > 0 && pageLength + separatorLength + block.length > 1050) {
      pages.push(pageBlocks.join("\n\n"));
      pageBlocks = [];
      pageLength = 0;
    }
    pageBlocks.push(block);
    pageLength += (pageBlocks.length > 1 ? 2 : 0) + block.length;
  }

  if (pageBlocks.length) pages.push(pageBlocks.join("\n\n"));
  return pages.length ? pages : [answer];
}

function renderMarkdownInline(value: string) {
  const tokens = value.split(/(`[^`]+`|\*\*.+?\*\*|__.+?__|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).filter(Boolean);
  return tokens.map((token, index) => {
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("__") && token.endsWith("__")) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("`")) return <code key={index}>{token.slice(1, -1)}</code>;
    if (token.startsWith("*") && token.endsWith("*")) return <em key={index}>{token.slice(1, -1)}</em>;
    return token;
  });
}

function renderMarkdown(markdown: string) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) code.push(lines[index++]);
      index += 1;
      blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const Heading = `h${Math.min(4, heading[1].length + 1)}` as "h2" | "h3" | "h4";
      blocks.push(<Heading key={`heading-${index}`}>{renderMarkdownInline(heading[2])}</Heading>);
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const headers = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(<div className="markdown-table-wrap" key={`table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderMarkdownInline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{renderMarkdownInline(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(lines[index]) || /^\s*\d+[.)]\s+/.test(lines[index])) {
      const ordered = /^\s*\d+[.)]\s+/.test(lines[index]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={index}>{renderMarkdownInline(item[1])}</li>);
        index += 1;
      }
      blocks.push(ordered ? <ol key={`list-${index}`}>{items}</ol> : <ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) quote.push(lines[index++].trim().replace(/^>\s?/, ""));
      blocks.push(<blockquote key={`quote-${index}`}>{renderMarkdownInline(quote.join(" "))}</blockquote>);
      continue;
    }
    if (/^(---+|\*\*\*+)$/.test(line)) { blocks.push(<hr key={`rule-${index}`} />); index += 1; continue; }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|```|>|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push(<p key={`paragraph-${index}`}>{renderMarkdownInline(paragraph.join(" "))}</p>);
  }
  return blocks;
}

function demoScoreCard(resume: Resume, index: number, weights: ScoreWeights): ScoreCard {
  if (resume.scoreCard) return { ...resume.scoreCard, weights, composite: calculateComposite(resume.scoreCard.criteria, weights) };
  const values = [78 + index * 4, 84 - index * 3, 82 + index * 2, 72 + index * 5, 86 - index * 2, 76 + index * 3];
  const criteria = Object.fromEntries(scoreCriteria.map(({ key }, criterionIndex) => [key, { score: boundedScore(values[criterionIndex]), evidence: ["示例资料中的工作成果与职责描述"] }])) as ScoreCard["criteria"];
  return { criteria, weights, composite: calculateComposite(criteria, weights), formula: "weighted-mean-v1", evaluatedAt: new Date().toISOString() };
}

function comparisonScoreCard(resume: Resume, index: number, weights: ScoreWeights): ScoreCard {
  const fallback = demoScoreCard(resume, index, weights);
  return resume.assessment ? scoreCardFromAssessment(resume.assessment, fallback) : fallback;
}

function hasAgentScore(resume: Resume): boolean {
  return Boolean(resume.assessment || resume.scoreCard);
}

function WeightProposalPreview({ proposal, currentWeights, impact, selectedHasScoreCard, onApply, onDiscard, busy }: { proposal: WeightProposal; currentWeights: ScoreWeights; impact: WeightImpact; selectedHasScoreCard: boolean; onApply: () => void; onDiscard: () => void; busy: boolean }) {
  const scoreChange = impact.proposedScore - impact.currentScore;
  const rankChange = impact.currentRank - impact.proposedRank;
  return <section className="weight-proposal">
    <div className="weight-proposal-heading"><span>AI 调整方案</span><strong>待确认</strong></div>
    <p>{proposal.rationale}</p>
    <div className="weight-impact"><div><span>当前候选人综合分</span><strong>{impact.currentScore.toFixed(1)} <small>→</small> {impact.proposedScore.toFixed(1)} <i className={scoreChange >= 0 ? "positive" : "negative"}>{scoreChange >= 0 ? "+" : ""}{scoreChange.toFixed(1)}</i></strong></div><div><span>同岗位族排名</span><strong>#{impact.currentRank}/{impact.total} <small>→</small> #{impact.proposedRank}/{impact.total} <i className={rankChange >= 0 ? "positive" : "negative"}>{rankChange > 0 ? `↑${rankChange}` : rankChange < 0 ? `↓${Math.abs(rankChange)}` : "不变"}</i></strong></div></div>
    <div className="weight-proposal-rows">{scoreCriteria.map(({ key, label }) => { const before = currentWeights[key]; const after = proposal.weights[key]; const delta = after - before; return <div key={key}><span>{label}</span><b>{before}% <small>→</small> {after}%{delta !== 0 && <i className={delta > 0 ? "positive" : "negative"}>{delta > 0 ? "+" : ""}{delta}</i>}</b></div>; })}</div>
    <small className="weight-impact-note">分数按已有单项评分重算，不会改写能力评分；排名比较 {impact.total} 份同岗位族档案，其中 {impact.demoCount} 份为演示档案。{selectedHasScoreCard ? "" : "当前候选人使用示例评分，影响仅供演示。"}</small>
    <div className="weight-proposal-actions"><button onClick={onDiscard} disabled={busy}><X size={13} />丢弃</button><button onClick={onApply} disabled={busy}>{busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}{busy ? "保存中" : "应用方案"}</button></div>
  </section>;
}

export default function App() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumesLoading, setResumesLoading] = useState(true);
  const [resumeLoadError, setResumeLoadError] = useState("");
  const [resumeLoadWarning, setResumeLoadWarning] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedResumeIds, setSelectedResumeIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [roleRequirements, setRoleRequirements] = useState(defaultAiRoleRequirements);
  const [question, setQuestion] = useState("请按岗位要求逐项分析候选人的 AI 工程能力、项目交付能力、技术深度、业务落地能力和风险点。");
  const [ocrText, setOcrText] = useState("");
  const [evidenceTarget, setEvidenceTarget] = useState("");
  const [evidenceLocation, setEvidenceLocation] = useState<{ query: string; page: number | null } | null>(null);
  const [answer, setAnswer] = useState("");
  const [analysisSections, setAnalysisSections] = useState<AnalysisSection[]>([]);
  const [agentError, setAgentError] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const [analysisDebug, setAnalysisDebug] = useState<AnalysisResult["debug"] | null>(null);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [importError, setImportError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [scoringRulesOpen, setScoringRulesOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLaunchFilter, setHistoryLaunchFilter] = useState<{ roleGroup: string; year: number | null; selectedId: string } | null>(null);
  const [historyCandidates, setHistoryCandidates] = useState<HistoricalCandidate[]>([]);
  const [resumeDecisions, setResumeDecisions] = useState<Record<string, ResumeDecision>>(() => {
    try {
      const stored = typeof window === "undefined" ? {} : JSON.parse(window.localStorage.getItem("bohack-resume-decisions") || "{}");
      return stored && typeof stored === "object" ? stored as Record<string, ResumeDecision> : {};
    } catch { return {}; }
  });
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [knowledgeTargetId, setKnowledgeTargetId] = useState<string | undefined>();
  const [knowledgeRecords, setKnowledgeRecords] = useState<KnowledgeRecord[]>(seedKnowledgeRecords);
  const [weights, setWeights] = useState<ScoreWeights>(defaultScoreWeights);
  const [weightInstruction, setWeightInstruction] = useState("");
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightProposal, setWeightProposal] = useState<WeightProposal | null>(null);
  const [weightError, setWeightError] = useState("");
  const [roleProfileBusy, setRoleProfileBusy] = useState(false);
  const [roleProfileProposal, setRoleProfileProposal] = useState<RoleProfileProposal | null>(null);
  const [roleProfileError, setRoleProfileError] = useState("");
  const [taskDraftBusy, setTaskDraftBusy] = useState(false);
  const [taskProposal, setTaskProposal] = useState<AnalysisTaskProposal | null>(null);
  const [taskDraftError, setTaskDraftError] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [documentColumnWidth, setDocumentColumnWidth] = useState<number | null>(null);
  const documentWidthManual = useRef(false);
  const documentResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const batchAnalysisControllers = useRef(new Map<number, AbortController>());
  const analysisRequest = useRef(0);
  const batchRun = useRef(0);

  type AnalyzeOptions = { batchRunId?: number; batchIndex?: number; batchTotal?: number };

  const selected = resumes.find((resume) => resume.id === selectedId) ?? resumes[0];
  useEffect(() => {
    documentWidthManual.current = false;
    setDocumentColumnWidth(null);
  }, [selected?.id]);

  const handleDocumentResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.matchMedia("(max-width: 930px)").matches) return;
    const element = event.currentTarget.parentElement;
    if (!element) return;
    documentWidthManual.current = true;
    documentResizeRef.current = { startX: event.clientX, startWidth: element.getBoundingClientRect().width };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const handleDocumentResizeMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = documentResizeRef.current;
    if (!start) return;
    const next = Math.round(Math.max(390, Math.min(2400, start.startWidth + event.clientX - start.startX)));
    setDocumentColumnWidth(next);
  }, []);

  const handleDocumentResizeEnd = useCallback(() => {
    documentResizeRef.current = null;
  }, []);
  const handlePreferredDocumentWidth = useCallback((width: number) => {
    if (documentWidthManual.current) return;
    setDocumentColumnWidth((current) => Math.max(current ?? 390, Math.min(2400, width)));
  }, []);
  const filtered = useMemo(() => resumes.filter((resume) => `${resume.name} ${resume.role}`.toLowerCase().includes(filter.toLowerCase())), [resumes, filter]);
  useEffect(() => {
    setSelectedResumeIds((current) => current.filter((id) => resumes.some((resume) => resume.id === id)));
  }, [resumes]);
  const weightImpact = useMemo<WeightImpact | null>(() => {
    if (!weightProposal || !selected) return null;
    const comparableResumes = resumes.filter((resume) => roleGroup(resume.role) === roleGroup(selected.role));
    const rankFor = (nextWeights: ScoreWeights) => comparableResumes.map((resume) => ({ id: resume.id, score: comparisonScoreCard(resume, resumes.indexOf(resume), nextWeights).composite })).sort((a, b) => b.score - a.score);
    const current = rankFor(weights);
    const proposed = rankFor(weightProposal.weights);
    return {
      currentScore: current.find((item) => item.id === selected.id)?.score ?? 0,
      proposedScore: proposed.find((item) => item.id === selected.id)?.score ?? 0,
      currentRank: current.findIndex((item) => item.id === selected.id) + 1,
      proposedRank: proposed.findIndex((item) => item.id === selected.id) + 1,
      total: comparableResumes.length,
      demoCount: comparableResumes.filter((resume) => resume.source === "demo").length,
    };
  }, [resumes, selected, weightProposal, weights]);

  useEffect(() => {
    loadResumes();
    fetch("/api/health").then((response) => response.json()).then(setHealth).catch(() => setHealth(null));
    fetch("/api/resumes/scoring/weights").then((response) => response.json()).then((payload) => payload.weights && setWeights(payload.weights)).catch(() => undefined);
    void refreshKnowledge();
    fetch("/api/resumes/history").then((response) => response.json()).then((payload) => { if (Array.isArray(payload.candidates)) setHistoryCandidates(payload.candidates); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("bohack-resume-decisions", JSON.stringify(resumeDecisions)); } catch { /* Local persistence is optional. */ }
  }, [resumeDecisions]);

  async function refreshKnowledge() {
    try {
      const response = await fetch("/api/resumes/knowledge");
      const payload = await response.json();
      if (response.ok && Array.isArray(payload.records)) setKnowledgeRecords(payload.records);
    } catch { /* Existing records remain available while the local API is unreachable. */ }
  }

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setAnalysisElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  async function updateWeights(next: ScoreWeights) {
    const normalized = normalizeWeights(next);
    setWeightSaving(true); setWeightError("");
    try {
      const response = await fetch("/api/resumes/scoring/weights", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weights: normalized }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "评分权重保存失败。");
      setWeights(payload.weights); setWeightProposal(null);
    } catch (error) {
      setWeightError(error instanceof Error ? error.message : "评分权重保存失败。");
    } finally { setWeightSaving(false); }
  }

  async function adjustWeightsWithAgent() {
    if (!weightInstruction.trim()) return;
    setWeightBusy(true); setWeightError(""); setWeightProposal(null);
    try {
      const response = await fetch("/api/resumes/scoring/weights/adjust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: weightInstruction, currentWeights: weights }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "权重调整失败");
      setWeightProposal({ weights: payload.weights, rationale: payload.rationale || "AI 已按你的要求生成权重建议。" });
    } catch (error) { setWeightError(error instanceof Error ? error.message : "权重调整失败"); } finally { setWeightBusy(false); }
  }

  async function structureRoleRequirements() {
    if (!roleRequirements.trim()) return;
    setRoleProfileBusy(true); setRoleProfileError(""); setRoleProfileProposal(null);
    try {
      const response = await fetch("/api/agent/role-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawRequirements: roleRequirements }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "职位要求整理失败。");
      setRoleProfileProposal({ requirements: payload.requirements || "", rationale: payload.rationale || "AI 已整理职位要求。" });
    } catch (error) { setRoleProfileError(error instanceof Error ? error.message : "职位要求整理失败。"); }
    finally { setRoleProfileBusy(false); }
  }

  async function structureAnalysisTask() {
    if (!question.trim()) return;
    setTaskDraftBusy(true); setTaskDraftError(""); setTaskProposal(null);
    try {
      const response = await fetch("/api/agent/task-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: question }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "分析任务整理失败。");
      setTaskProposal({ question: payload.question || "", rationale: payload.rationale || "AI 已将任务整理为可执行的分析要求。" });
    } catch (error) { setTaskDraftError(error instanceof Error ? error.message : "分析任务整理失败。"); }
    finally { setTaskDraftBusy(false); }
  }

  useEffect(() => {
    if (selected?.source !== "pdf") {
      setPdfUrl("");
      return;
    }
    setPdfUrl(`/api/resumes/${encodeURIComponent(selected.id)}/file`);
  }, [selected]);

  async function loadResumes(selectFirst = false) {
    setResumesLoading(true);
    setResumeLoadError("");
    try {
      const response = await fetch("/api/resumes");
      if (!response.ok) throw new Error("无法读取简历文件夹。");
      const payload = await response.json() as ResumeListResponse;
      if (!Array.isArray(payload.resumes)) throw new Error("简历列表格式无效。");
      // The sidebar reflects the local resume folder. Built-in demo candidates
      // remain available only in the historical sample database, not alongside
      // imported resumes in the active workspace.
      setResumes(payload.resumes.map((resume) => ({ ...resume, reviewStatus: resume.reviewStatus ?? resumeDecisions[resume.id] ?? "pending" })));
      setResumeLoadWarning(payload.skippedFiles?.length
        ? `已读取其余简历；以下 PDF 无法解析：${payload.skippedFiles.map((file) => file.fileName).join("、")}`
        : "");
      if (payload.resumes.length && (selectFirst || !payload.resumes.some((resume) => resume.id === selectedId))) {
        setSelectedId(payload.resumes[0].id);
      }
    } catch {
      setResumeLoadError("无法读取本地简历库，请确认服务正在运行后重试。");
    } finally { setResumesLoading(false); }
  }

  async function decideResume(decision: Exclude<ResumeDecision, "pending">, resumeId = selected?.id) {
    const target = resumeId ? resumes.find((resume) => resume.id === resumeId) : selected;
    if (!target || decisionBusy) return;
    const current = target.reviewStatus ?? resumeDecisions[target.id] ?? "pending";
    if (current === decision) return;
    setDecisionBusy(true); setDecisionError("");
    try {
      if (target.source === "pdf") {
        const response = await fetch(`/api/resumes/${encodeURIComponent(target.id)}/decision`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "无法保存简历审核结果。");
        if (payload.resume) setResumes((currentResumes) => currentResumes.map((resume) => resume.id === target.id ? payload.resume as Resume : resume));
      }
      setResumeDecisions((currentDecisions) => ({ ...currentDecisions, [target.id]: decision }));
      setResumes((currentResumes) => currentResumes.map((resume) => resume.id === target.id ? { ...resume, reviewStatus: decision } : resume));
    } catch (cause) { setDecisionError(cause instanceof Error ? cause.message : "无法保存简历审核结果。"); }
    finally { setDecisionBusy(false); }
  }

  async function importPdfs(files?: FileList | null) {
    if (!files?.length) return;
    const pdfFiles = Array.from(files).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    setImportError("");
    setAnswer("");
    setAnalysisSections([]);
    setAnalysisProgress(null);
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
      const latest = imported[imported.length - 1];
      setSelectedId(latest.id);
      setAnswer(latest.analysisReport ?? "");
      setAgentError(latest.analysisStatus === "failed" && !latest.assessment ? latest.analysisError ?? "自动分析未完成，可手动重试。" : "");
      const pendingIds = imported.filter((resume) => resume.analysisStatus === "processing").map((resume) => resume.id);
      if (pendingIds.length) {
        void (async () => {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            try {
              const response = await fetch("/api/resumes");
              if (!response.ok) return;
              const payload = await response.json() as ResumeListResponse;
              if (!Array.isArray(payload.resumes)) return;
              const selectedUpdate = payload.resumes.find((resume) => resume.id === selectedId && pendingIds.includes(resume.id));
              if (selectedUpdate?.analysisStatus === "complete") setAnswer(selectedUpdate.analysisReport ?? "");
              if (selectedUpdate?.analysisStatus === "failed") setAgentError(selectedUpdate.analysisError ?? "后台分析失败，可重新分析。");
              setResumes((current) => current.map((resume) => payload.resumes.find((next) => next.id === resume.id) ?? resume));
              if (payload.resumes.filter((resume) => pendingIds.includes(resume.id)).every((resume) => resume.analysisStatus !== "processing")) return;
            } catch { return; }
          }
        })();
      }
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

  async function analyze(target: Resume = selected, options: AnalyzeOptions = {}): Promise<boolean> {
    if (!target) return false;
    const background = options.batchRunId !== undefined;
    const requestId = background ? 0 : ++analysisRequest.current;
    if (!background) analysisController.current?.abort();
    const controller = new AbortController();
    if (background && options.batchRunId !== undefined) batchAnalysisControllers.current.set(options.batchRunId * 1000 + (options.batchIndex ?? 0), controller);
    if (!background) analysisController.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error("分析响应超时，已完成资料仍可查看，请重试。")), 310_000);
    if (!background) {
      setBusy(true);
      setAgentError("");
      setAnswer("");
      setAnalysisProgress({ stage: "extracting", message: "正在连接分析服务。" });
      setAnalysisElapsed(0);
      setAnalysisDebug(null);
    }
    const isCurrent = () => background || requestId === analysisRequest.current;
    const applyResult = (result: AnalysisResult) => {
      if (!background) {
        setAnswer(result.answer);
        if (result.debug) setAnalysisDebug(result.debug);
      }
      if (result.resume) {
        if (!background) setAnalysisDebug(result.debug ?? result.resume.analysisDebug ?? null);
        setResumes((current) => current.map((resume) => resume.id === target.id ? result.resume! : resume));
      }
      else if (result.assessment) setResumes((current) => current.map((resume) => resume.id === target.id ? { ...resume, assessment: result.assessment, assessmentHistory: [...(resume.assessmentHistory ?? []), { reason: "review", assessment: result.assessment! }], analysisReport: result.answer } : resume));
    };
    try {
      const useStoredReport = target.source === "pdf";
      const endpoint = useStoredReport ? `/api/resumes/${encodeURIComponent(target.id)}/analyze` : "/api/agent";
      const targetOcrText = target.id === selected.id ? ocrText : "";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeName: target.name, resumeText: targetOcrText.trim() ? targetOcrText : target.text, ocrText: targetOcrText, roleRequirements, question, streamProgress: true, force: true }),
        signal: controller.signal,
      });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
        const payload = await response.json();
        if (!isCurrent()) return false;
        if (!response.ok) throw new Error(payload.error || "分析请求失败。");
        applyResult(payload);
      } else {
        await readAnalysisEvents(response, (event: AnalysisEvent) => {
          if (!isCurrent()) return;
          if (event.type === "progress" && !background) setAnalysisProgress(event.progress);
          if (event.type === "assessment" && event.assessment) {
            setResumes((current) => current.map((resume) => resume.id === target.id ? { ...resume, assessment: event.assessment } : resume));
          }
          if (event.type === "agent" && !background) {
            setAnalysisSections((current) => {
              const next = current.filter((section) => section.agentId !== event.agentId);
              return [...next, { agentId: event.agentId, label: event.label, markdown: event.markdown, timing: event.timing }];
            });
            if (event.timing) setAnalysisDebug((current) => ({ totalDurationMs: current?.totalDurationMs ?? 0, maxParallel: Math.max(current?.maxParallel ?? 1, event.timing!.parallelWith.length + 1), timings: [...(current?.timings ?? []).filter((item) => item.id !== event.timing!.id), event.timing!] }));
            if (event.markdown) setAnswer((current) => `${current}${current ? "\n\n" : ""}${event.markdown}`);
          }
          if (event.type === "answer" && !background) setAnswer((current) => event.replace ? event.text : current + event.text);
          if (event.type === "complete") applyResult(event);
        });
      }
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      if (!background) setAgentError(reason instanceof Error ? reason.message : "无法连接 Agent 服务。");
      return false;
    } finally {
      clearTimeout(timeout);
      if (background && options.batchRunId !== undefined) batchAnalysisControllers.current.delete(options.batchRunId * 1000 + (options.batchIndex ?? 0));
      if (!background && analysisController.current === controller) analysisController.current = null;
      if (!background) void refreshKnowledge();
      if (!background && requestId === analysisRequest.current) setBusy(false);
    }
  }

  function toggleResumeSelection(id: string) {
    setSelectedResumeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function selectAllFiltered() {
    setSelectedResumeIds((current) => Array.from(new Set([...current, ...filtered.map((resume) => resume.id)])));
  }

  function clearResumeSelection() {
    setSelectedResumeIds([]);
  }

  async function analyzeSelectedResumes() {
    if (batchBusy || !selectedResumeIds.length || !health?.agent) return;
    const runId = ++batchRun.current;
    const targets = selectedResumeIds.map((id) => resumes.find((resume) => resume.id === id)).filter((resume): resume is Resume => Boolean(resume));
    setBatchBusy(true);
    setBatchProgress(`准备分析 ${targets.length} 份简历`);
    let nextIndex = 0;
    let completed = 0;
    let failed = 0;
    const worker = async () => {
      while (batchRun.current === runId) {
        const index = nextIndex++;
        if (index >= targets.length) return;
        const target = targets[index];
        setBatchProgress(`并行分析中 · ${completed} / ${targets.length} 已完成 · 当前 ${target.name}`);
        const ok = await analyze(target, { batchRunId: runId, batchIndex: index, batchTotal: targets.length });
        completed += 1;
        if (!ok) failed += 1;
        if (batchRun.current === runId) setBatchProgress(`并行分析中 · ${completed} / ${targets.length} 已完成${ok ? "" : ` · ${target.name}失败`}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()));
    if (batchRun.current === runId) {
      setBatchBusy(false);
      setBatchProgress(targets.length ? `批量分析完成 · ${targets.length - failed} 份成功${failed ? ` · ${failed} 份失败` : ""}` : "");
    }
  }

  function openKnowledge(id?: string) {
    void refreshKnowledge();
    setScoringOpen(false);
    setScoringRulesOpen(false);
    setKnowledgeTargetId(id);
    setKnowledgeOpen(true);
    setComparisonOpen(false);
    setHistoryOpen(false);
  }

  function openHistory(roleGroupFilter?: string, year?: number | null, selectedHistoryId?: string) {
    setScoringOpen(false);
    setScoringRulesOpen(false);
    setHistoryLaunchFilter(roleGroupFilter ? { roleGroup: roleGroupFilter, year: year ?? null, selectedId: selectedHistoryId ?? "" } : null);
    setHistoryOpen(true);
    setKnowledgeOpen(false);
    setComparisonOpen(false);
  }

  function showAnalysisWorkspace() {
    setScoringOpen(false);
    setScoringRulesOpen(false);
    setKnowledgeOpen(false);
    setHistoryOpen(false);
    setHistoryLaunchFilter(null);
    setComparisonOpen(false);
  }

  function renderTopbar() {
    const analysisActive = !scoringOpen && !scoringRulesOpen && !knowledgeOpen && !historyOpen && !comparisonOpen;
    return <header className="topbar">
      <button className="brand" type="button" aria-label="返回简历分析" onClick={showAnalysisWorkspace}>
        <span className="brand-mark"><BookOpen size={17} strokeWidth={2.2} /></span>
        <span className="brand-name">简阅</span>
      </button>
      <nav className="topbar-nav" aria-label="工作区">
        <button type="button" className={`topbar-nav-item ${analysisActive ? "active" : ""}`} aria-current={analysisActive ? "page" : undefined} onClick={showAnalysisWorkspace}>简历分析</button>
        <button type="button" className={`topbar-nav-item ${scoringOpen ? "active" : ""}`} aria-current={scoringOpen ? "page" : undefined} disabled={!selected} onClick={() => { setScoringOpen(true); setScoringRulesOpen(false); setKnowledgeOpen(false); setHistoryOpen(false); setComparisonOpen(false); }}>评分详情</button>
        <button type="button" className={`topbar-nav-item ${scoringRulesOpen ? "active" : ""}`} aria-current={scoringRulesOpen ? "page" : undefined} disabled={!selected} onClick={() => { setScoringOpen(false); setScoringRulesOpen(true); setKnowledgeOpen(false); setHistoryOpen(false); setComparisonOpen(false); }}>算法参数</button>
        <button type="button" className={`topbar-nav-item ${comparisonOpen ? "active" : ""}`} aria-current={comparisonOpen ? "page" : undefined} disabled={!resumes.length} onClick={() => { setScoringOpen(false); setScoringRulesOpen(false); setComparisonOpen(true); setKnowledgeOpen(false); setHistoryOpen(false); }}>候选人对比</button>
        <button type="button" className={`topbar-nav-item ${knowledgeOpen ? "active" : ""}`} aria-current={knowledgeOpen ? "page" : undefined} onClick={() => openKnowledge()}>资料库</button>
        <button type="button" className={`topbar-nav-item ${historyOpen ? "active" : ""}`} aria-current={historyOpen ? "page" : undefined} onClick={() => openHistory()}>历史样本</button>
      </nav>
      <div className="topbar-spacer" />
      <div className="privacy-note"><ShieldCheck size={15} /> 本地存储</div>
    </header>;
  }

  function selectResume(id: string) {
    analysisRequest.current += 1;
    analysisController.current?.abort();
    setBusy(false);
    setOcrText("");
    setAnalysisProgress(null);
    const resume = resumes.find((item) => item.id === id);
    setSelectedId(id);
    setAnswer(resume?.analysisReport ?? "");
    setAnalysisSections([]);
    setAnalysisDebug(resume?.analysisDebug ?? null);
    setAnalysisProgress(null);
    setEvidenceTarget("");
    setEvidenceLocation(null);
    setDecisionError("");
    setAgentError(resume?.analysisStatus === "failed" && !resume.assessment ? resume.analysisError ?? "自动分析未完成，可手动重试。" : "");
  }

  function selectResumeEvidence(id: string, evidence: string) {
    selectResume(id);
    setEvidenceTarget(evidence);
    setEvidenceLocation({ query: evidence, page: null });
  }

  const handleEvidenceResult = useCallback((result: { query: string; page: number | null }) => setEvidenceLocation(result), []);
  const locateEvidence = useCallback((evidence: string) => { setEvidenceTarget(evidence); setEvidenceLocation({ query: evidence, page: null }); }, []);

  function stopAnalysis() {
    batchRun.current += 1;
    analysisRequest.current += 1;
    analysisController.current?.abort();
    for (const controller of batchAnalysisControllers.current.values()) controller.abort();
    batchAnalysisControllers.current.clear();
    setBusy(false);
    setBatchBusy(false);
    setBatchProgress("分析已停止，已完成的候选人结果已保留。");
    setAgentError("分析已停止，已完成的材料结果仍可查看。");
  }
  if (!selected) return <div className="app-shell">
    {renderTopbar()}
    <div className="resume-startup-workspace">
      {knowledgeOpen ? <KnowledgeLibraryView resumes={resumes} records={knowledgeRecords} onRecordsChange={setKnowledgeRecords} initialId={knowledgeTargetId} onSelectEvidence={selectResumeEvidence} onClose={() => setKnowledgeOpen(false)} agentAvailable={Boolean(health?.agent)} webSearchAvailable={Boolean(health?.webSearch)} />
        : historyOpen ? <HistoricalDatabaseView candidates={historyCandidates} onCandidatesChange={setHistoryCandidates} initialFilter={historyLaunchFilter} initialSelectedId={historyLaunchFilter?.selectedId ?? ""} />
          : <main className="resume-startup" aria-busy={resumesLoading || extracting}>
            <section className="resume-startup-card">
              {resumesLoading ? <LoaderCircle className="spin" size={32} /> : <FolderOpen size={32} />}
              <h1>{resumesLoading ? "正在读取简历库" : resumeLoadError ? "简历库读取失败" : "还没有简历"}</h1>
              <p role={resumeLoadError ? "alert" : "status"}>{resumesLoading ? "正在读取本地简历，请稍候。" : resumeLoadError || "导入 PDF 简历或整个文件夹，开始查看与分析。"}</p>
              {importError && <p className="inline-error" role="alert">{importError}</p>}
              <div className="resume-startup-actions">
                <button className="import-button" onClick={() => fileInput.current?.click()} disabled={resumesLoading || extracting}>{extracting ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{extracting ? `正在识别 ${importProgress}` : "导入 PDF 简历"}</button>
                <button className="secondary-action" onClick={() => folderInput.current?.click()} disabled={resumesLoading || extracting}><FolderOpen size={14} />导入文件夹</button>
                <button className="secondary-action" onClick={() => void loadResumes()} disabled={resumesLoading || extracting}>{resumesLoading ? "读取中…" : "重新读取简历库"}</button>
                <button className="secondary-action" onClick={openResumeFolder} disabled={resumesLoading || extracting}><FolderOpen size={14} />打开存储位置</button>
              </div>
            </section>
          </main>}
    </div>
    <input ref={fileInput} className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple onChange={(event) => importPdfs(event.target.files)} />
    <input ref={(element) => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} className="visually-hidden" type="file" multiple onChange={(event) => importPdfs(event.target.files)} />
  </div>;

  return (
    <div className="app-shell">
      {renderTopbar()}

      <div className={`workspace ${comparisonOpen ? "comparison-mode" : ""}`} style={{ "--document-column-width": documentColumnWidth ? `${documentColumnWidth}px` : undefined } as CSSProperties}>
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-title-row"><h1>简历库</h1><span className="count-badge">{resumes.length}</span></div>
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
            {resumeLoadError && <div className="inline-error" role="alert">{resumeLoadError}<button type="button" onClick={() => void loadResumes()} disabled={resumesLoading}>重试</button></div>}
            {resumeLoadWarning && <div className="inline-error" role="status">{resumeLoadWarning}</div>}
          </div>

          <div className="list-label"><span>候选人</span><div className="list-label-actions"><span>最近更新</span><button type="button" className="selection-mode-toggle" onClick={() => setSelectionMode((current) => !current)} disabled={batchBusy}>{selectionMode ? "完成" : "多选"}</button></div></div>
          {selectionMode && <div className="selection-toolbar" aria-label="批量简历操作">
            <div className="selection-toolbar-head"><strong>已选择 {selectedResumeIds.length} 份</strong><span>{filtered.length} 份当前结果</span></div>
            <div className="selection-toolbar-actions">
              <button type="button" onClick={selectAllFiltered} disabled={batchBusy || !filtered.length}>全选当前</button>
              <button type="button" onClick={clearResumeSelection} disabled={batchBusy || !selectedResumeIds.length}>清除</button>
              <button type="button" className="selection-action-primary" onClick={() => void analyzeSelectedResumes()} disabled={batchBusy || !selectedResumeIds.length || !health?.agent}>
                {batchBusy ? <LoaderCircle className="spin" size={12} /> : <Sparkles size={12} />}
                {batchBusy ? "批量分析中" : "批量重新分析"}
              </button>
              <button type="button" onClick={() => { if (selectedResumeIds.length) { setComparisonOpen(true); setScoringOpen(false); setScoringRulesOpen(false); setKnowledgeOpen(false); setHistoryOpen(false); } }} disabled={batchBusy || !selectedResumeIds.length}>
                <BriefcaseBusiness size={12} />批量对比
              </button>
            </div>
            {batchProgress && <div className="selection-progress" role="status">{batchProgress}</div>}
          </div>}
          <div className="candidate-list">
            {filtered.map((resume, index) => {
              const reviewStatus = resume.reviewStatus ?? "pending";
              return <div className={`candidate-row ${resume.id === selected.id ? "selected" : ""} ${selectedResumeIds.includes(resume.id) ? "checked" : ""} ${reviewStatus === "passed" ? "review-passed" : reviewStatus === "rejected" ? "review-rejected" : ""}`} key={resume.id}>
                {selectionMode && <input className="candidate-checkbox" type="checkbox" checked={selectedResumeIds.includes(resume.id)} onChange={() => toggleResumeSelection(resume.id)} disabled={batchBusy} aria-label={`选择${resume.name}`} />}
                <button className="candidate-row-main" type="button" onClick={() => selectResume(resume.id)} disabled={batchBusy}>
                <span className={`candidate-avatar avatar-${index % 4}`}>{resume.initials}</span>
                <span className="candidate-copy"><strong>{resume.name}</strong><span>{resume.identity || resume.role}</span>{resume.keywords?.length ? <small className="candidate-keywords">{resume.keywords.slice(0, 3).join(" · ")}</small> : null}{reviewStatus !== "pending" && <em className={`candidate-review-status ${reviewStatus}`}>{reviewStatus === "passed" ? "已通过初筛" : "已拒绝"}</em>}</span>
                <span className="candidate-date">{resume.received}</span>
                </button>
              </div>;
            })}
            {filtered.length === 0 && <div className="empty-list">没有匹配的简历</div>}
          </div>
          <div className="sidebar-footer"><span className="status-dot" /> 本地工作区 <span className="footer-count">{resumes.length} 份简历</span></div>
        </aside>

            {scoringRulesOpen ? <ScoringWorkspace key="scoring-rules" initialTab="rules" resumes={resumes} selected={selected} onSelect={selectResume} onUpdate={(updated) => { setResumes((current) => current.map((resume) => resume.id === updated.id ? updated : resume)); }} onEvidence={locateEvidence} onRead={() => setScoringRulesOpen(false)} agentAvailable={Boolean(health?.agent)} /> : scoringOpen ? <ScoringWorkspace key="scoring-detail" initialTab="candidate" resumes={resumes} selected={selected} onSelect={selectResume} onUpdate={(updated) => { setResumes((current) => current.map((resume) => resume.id === updated.id ? updated : resume)); if (updated.id === selected.id && updated.analysisReport) setAnswer(updated.analysisReport); }} onEvidence={(quote) => { setScoringOpen(false); locateEvidence(quote); }} onRead={() => setScoringOpen(false)} agentAvailable={Boolean(health?.agent)} /> : historyOpen ? <HistoricalDatabaseView candidates={historyCandidates} onCandidatesChange={setHistoryCandidates} initialFilter={historyLaunchFilter} initialSelectedId={historyLaunchFilter?.selectedId ?? ""} /> : knowledgeOpen ? <KnowledgeLibraryView resumes={resumes} records={knowledgeRecords} onRecordsChange={setKnowledgeRecords} initialId={knowledgeTargetId} onSelectEvidence={selectResumeEvidence} onClose={() => setKnowledgeOpen(false)} agentAvailable={Boolean(health?.agent)} webSearchAvailable={Boolean(health?.webSearch)} /> : <>
              {comparisonOpen && <ComparisonView key="comparison" resumes={resumes.filter((resume) => !selectedResumeIds.length || selectedResumeIds.includes(resume.id))} weights={weights} selectedId={selected.id} onSelectResume={selectResume} onEvidence={locateEvidence} onClose={() => setComparisonOpen(false)} agentAvailable={Boolean(health?.agent)} knowledgeRecords={knowledgeRecords} onDecision={(id, decision) => void decideResume(decision, id)} decisionBusy={decisionBusy || batchBusy} decisionError={decisionError} />}
              {!comparisonOpen && <>
        <main className="document-column">
          <div className="document-header">
            <div className="document-person">
              <span className={`candidate-avatar large avatar-${Math.max(0, resumes.indexOf(selected)) % 4}`}>{selected.initials}</span>
              <div><div className="person-title"><h2>{selected.name}</h2><span className={selected.source === "demo" ? "sample-tag" : "pdf-tag"}>{selected.source === "demo" ? "示例资料" : "PDF"}</span></div><p>{selected.role}<span className="meta-dot">·</span>{selected.location}</p></div>
            </div>
            <div className="document-actions">
              {selected.source === "pdf" && pdfUrl && <a className="icon-button" href={pdfUrl} download={`${selected.name}.pdf`} title="下载原始 PDF" aria-label="下载原始 PDF"><ArrowDownToLine size={17} /></a>}
              <div className="decision-actions" role="group" aria-label={`${selected.name}审核结果`}>
                <button type="button" className={`decision-button pass ${(selected.reviewStatus ?? resumeDecisions[selected.id] ?? "pending") === "passed" ? "active" : ""}`} onClick={() => void decideResume("passed")} disabled={decisionBusy || batchBusy} title="标记为通过初筛">{(selected.reviewStatus ?? resumeDecisions[selected.id] ?? "pending") === "passed" ? "已通过" : "通过"}</button>
                <button type="button" className={`decision-button reject ${(selected.reviewStatus ?? resumeDecisions[selected.id] ?? "pending") === "rejected" ? "active" : ""}`} onClick={() => void decideResume("rejected")} disabled={decisionBusy || batchBusy}>{(selected.reviewStatus ?? resumeDecisions[selected.id] ?? "pending") === "rejected" ? "已拒绝" : "拒绝"}</button>
              </div>
              <button className="analyze-button" onClick={() => void analyze()} disabled={busy || batchBusy || selected.analysisStatus === "processing" || !health?.agent} title={!health?.agent ? "请先在 .env 配置模型服务" : "使用 Agent 分析这份简历"}>
                {busy || selected.analysisStatus === "processing" ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                {busy ? "分析中" : selected.analysisStatus === "processing" ? "后台分析中" : selected.analysisStatus === "failed" ? "重试分析" : "重新分析"}
              </button>
            </div>
          </div>
          {decisionError && <div className="decision-error" role="alert">{decisionError}</div>}

          <div className="document-toolbar">
            <div className="document-tab"><FileText size={15} /><span>{selected.source === "pdf" ? (selected.fileName ?? `${selected.name}.pdf`) : "简历预览"}</span></div>
            <div className="reader-controls"><span>{selected.source === "pdf" ? "本地 PDF" : "示例资料"}</span><span className="toolbar-separator" /><span>{selected.size ? `${Math.max(1, Math.round(selected.size / 1024))} KB` : "A4"}</span></div>
          </div>

          <section className="reader-area" aria-label="简历阅读区">
            {selected.source === "pdf" && pdfUrl ? (
              <PdfReader key={selected.id} url={pdfUrl} title={selected.fileName ?? `${selected.name}.pdf`} evidenceTarget={evidenceTarget} knowledgeRecords={knowledgeRecords} onEvidenceResult={handleEvidenceResult} onPreferredWidth={handlePreferredDocumentWidth} />
            ) : (
              <div className="sample-page">
                <div className="sample-document-label"><span>简阅示例</span><span>简历资料 · 示例</span></div>
                <div className="sample-name-block"><div><h3>{selected.name}</h3><p>{selected.role} <span>·</span> {selected.location}</p></div><div className="sample-contact">人才档案<br />{selected.name.toLowerCase().replace(" ", ".")}@example.com</div></div>
                <div className="sample-summary">{renderEvidenceText(`${selected.text.split("。")[0]}。`, evidenceTarget)}</div>
                <div className="sample-section"><h4>工作经历</h4>{(selected.experiences ?? []).map((experience) => <article className="experience" key={experience.company}><div className="experience-heading"><div><strong>{experience.role}</strong><span>{experience.company}</span></div><time>{experience.period}</time></div><p>{renderEvidenceText(experience.detail, evidenceTarget)}</p></article>)}</div>
                <div className="sample-section"><h4>教育背景</h4><p className="sample-body">{renderEvidenceText(selected.education, evidenceTarget)}</p></div>
                <div className="sample-section"><h4>专业技能</h4><div className="skill-list">{selected.skills.map((skill) => <span key={skill}>{renderEvidenceText(skill, evidenceTarget)}</span>)}</div></div>
                <div className="sample-doc-footer">示例资料仅用于体验工作台。导入 PDF 后将在此处显示原始文件。</div>
              </div>
            )}
          </section>
          <button className="document-column-resizer" type="button" aria-label="调整简历阅读区宽度" title="左右拖动调整简历阅读区宽度" onPointerDown={handleDocumentResizeStart} onPointerMove={handleDocumentResizeMove} onPointerUp={handleDocumentResizeEnd} onPointerCancel={handleDocumentResizeEnd} />
        </main>

        <aside className="report-column">
          <div className="analysis-header"><div><span className="eyebrow">CANDIDATE REPORT</span><h2>分析文档</h2></div><span className={`report-status ${selected.analysisStatus === "complete" ? "complete" : selected.analysisStatus === "failed" ? "failed" : ""}`}>{selected.analysisStatus === "complete" ? "已生成" : selected.analysisStatus === "processing" ? "分析中" : selected.analysisStatus === "failed" ? "待重试" : answer ? "已生成" : "待生成"}</span></div>
          <div className="result-heading"><div><MessageSquareText size={16} /><h3>分析报告</h3></div>{answer && <button className="clear-result" onClick={() => setAnswer("")} title="清除分析文档" aria-label="清除分析文档"><X size={15} /></button>}</div>
          <AnalysisDocument answer={answer} sections={analysisSections} busy={busy || selected.analysisStatus === "processing"} error={agentError} candidate={selected} roleRequirements={roleRequirements} scoreCard={demoScoreCard(selected, Math.max(0, resumes.indexOf(selected)), weights)} knowledgeRecords={knowledgeRecords} historyCandidates={historyCandidates} onOpenKnowledge={openKnowledge} onOpenHistory={openHistory} onOpenScoring={() => { setScoringRulesOpen(false); setScoringOpen(true); }} agentAvailable={Boolean(health?.agent)} onEvidence={locateEvidence} />
          {evidenceLocation && <div className={`evidence-location ${evidenceLocation.page ? "found" : "missing"}`}><ShieldCheck size={12} /><span>{evidenceLocation.page ? `已在简历第 ${evidenceLocation.page} 页定位依据` : "这条依据尚未在 PDF 原文中精确定位"}</span><button onClick={() => { setEvidenceTarget(""); setEvidenceLocation(null); }} aria-label="关闭证据定位提示"><X size={12} /></button></div>}
           <div className="analysis-footer"><ShieldCheck size={14} /><span>分析基于当前简历文本和已生成的规则评分。</span></div>
        </aside>
              </>}

        <aside className="analysis-column">
          {comparisonOpen && <ComparisonSelectedSidebar candidate={selected} weights={weights} index={Math.max(0, resumes.indexOf(selected))} />}
          {comparisonOpen && <section className="comparison-job-sidebar" aria-label="多人对比岗位偏好调参">
            <div className="comparison-job-sidebar-head"><div><span className="eyebrow">COMPARISON AI TUNING</span><h2>多人 AI 调参台</h2></div><span>{Object.values(weights).reduce((sum, value) => sum + value, 0)}%</span></div>
            <p className="comparison-job-sidebar-note">修改岗位要求或权重后，中央排名会即时重算；不会改写候选人的原始能力评分。</p>
            <label className="field-label" htmlFor="comparison-role-requirements"><span className="field-label-title">岗位要求 <em>用于当前对比</em></span><button type="button" className="field-agent-button" onClick={structureRoleRequirements} disabled={roleProfileBusy || !health?.agent || !roleRequirements.trim()}>{roleProfileBusy ? <LoaderCircle className="spin" size={12} /> : <Sparkles size={12} />}整理岗位重点</button></label>
            <textarea id="comparison-role-requirements" className="role-input comparison-role-input" value={roleRequirements} onChange={(event) => { setRoleRequirements(event.target.value); setRoleProfileProposal(null); setRoleProfileError(""); }} rows={6} />
            {roleProfileProposal && <div className="role-profile-proposal"><strong>AI 整理草案</strong><p>{roleProfileProposal.requirements}</p><small>{roleProfileProposal.rationale}</small><div><button type="button" onClick={() => { setRoleRequirements(roleProfileProposal.requirements); setRoleProfileProposal(null); }}>采用草案</button><button type="button" onClick={() => setRoleProfileProposal(null)}>保留原文</button></div></div>}
            {roleProfileError && <div className="inline-error">{roleProfileError}</div>}
            <div className="comparison-weight-heading"><strong>排序权重</strong><span>总和自动归一化</span></div>
            <div className="comparison-weight-list">{scoreCriteria.map(({ key, label }) => <label key={key}><span>{label}</span><input type="number" min="0" max="100" value={weights[key]} onChange={(event) => { setWeights({ ...weights, [key]: Number(event.target.value) } as ScoreWeights); setWeightProposal(null); setWeightError(""); }} onBlur={() => void updateWeights(weights)} /><b>%</b></label>)}</div>
            <div className="weight-agent comparison-weight-agent"><input value={weightInstruction} onChange={(event) => { setWeightInstruction(event.target.value); setWeightProposal(null); setWeightError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void adjustWeightsWithAgent(); } }} placeholder="让 AI 调整排序权重" /><button title="让 AI 调整排序权重" aria-label="让 AI 调整排序权重" onClick={() => void adjustWeightsWithAgent()} disabled={weightBusy || weightSaving || !health?.agent}>{weightBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}</button></div>
            {weightError && <div className="inline-error">{weightError}</div>}
            {weightProposal && weightImpact && <WeightProposalPreview proposal={weightProposal} currentWeights={weights} impact={weightImpact} selectedHasScoreCard={hasAgentScore(selected)} onDiscard={() => setWeightProposal(null)} onApply={() => void updateWeights(weightProposal.weights)} busy={weightSaving} />}
          </section>}
          <div className="analysis-header"><div><span className="eyebrow">简阅智能助手</span><h2>分析工作区</h2></div><span className={`agent-indicator ${health?.agent ? "ready" : ""}`} title={health?.agent ? "模型已连接" : "等待配置模型服务"}><span /></span></div>
          <div className="agent-capabilities"><div><Sparkles size={14} /><span>简历分析 Skill</span><Check size={14} className="capability-check" /></div><div><Globe2 size={14} /><span>网页搜索</span><span className={`capability-state ${health?.webSearch ? "available" : "unavailable"}`}>{health?.webSearch ? "已连接" : "待配置"}</span></div></div>
          <label className="field-label" htmlFor="role-requirements"><span className="field-label-title">职位要求 <em>可选</em></span><button type="button" className="field-agent-button" onClick={structureRoleRequirements} disabled={roleProfileBusy || !health?.agent || !roleRequirements.trim()} title="让 AI 整理职位要求">{roleProfileBusy ? <LoaderCircle className="spin" size={12} /> : <Sparkles size={12} />}整理岗位重点</button></label>
          <textarea id="role-requirements" className="role-input" value={roleRequirements} onChange={(event) => { setRoleRequirements(event.target.value); setRoleProfileProposal(null); setRoleProfileError(""); }} placeholder="粘贴职位描述或关键要求，例如：5 年以上 B2B 产品经验，熟悉数据分析与团队协作……" rows={5} />
          {roleProfileProposal && <div className="role-profile-proposal"><strong>AI 整理草案</strong><p>{roleProfileProposal.requirements}</p><small>{roleProfileProposal.rationale}</small><div><button type="button" onClick={() => { setRoleRequirements(roleProfileProposal.requirements); setRoleProfileProposal(null); }}>采用草案</button><button type="button" onClick={() => setRoleProfileProposal(null)}>保留原文</button></div></div>}
          {roleProfileError && <div className="inline-error">{roleProfileError}</div>}
          <label className="field-label question-label" htmlFor="agent-question"><span>分析任务</span><button type="button" className="field-agent-button" onClick={structureAnalysisTask} disabled={taskDraftBusy || !health?.agent || !question.trim()} title="只将任务文本发送给 AI，不发送简历内容">{taskDraftBusy ? <LoaderCircle className="spin" size={12} /> : <Sparkles size={12} />}优化任务</button></label>
          <textarea id="agent-question" className="question-input" value={question} onChange={(event) => { setQuestion(event.target.value); setTaskProposal(null); setTaskDraftError(""); }} rows={3} />
          {taskDraftError && <div className="inline-error">{taskDraftError}</div>}
          {taskProposal && <div className="role-profile-proposal"><strong>AI 任务草案</strong><p>{taskProposal.question}</p><small>{taskProposal.rationale} · 仅发送了当前任务文本，未发送简历或候选人信息。</small><div><button type="button" onClick={() => { setQuestion(taskProposal.question); setTaskProposal(null); }}>采用草案</button><button type="button" onClick={() => setTaskProposal(null)}>保留原文</button></div></div>}
          <div className="agent-presets" aria-label="常用分析任务"><span>快捷任务</span>{["提炼核心优势与风险", "按岗位要求逐项核对证据", "生成面试追问清单"].map((preset) => <button key={preset} onClick={() => { setQuestion(preset); setTaskProposal(null); setTaskDraftError(""); }}>{preset}</button>)}</div>
          <details className="ocr-input"><summary>补充 OCR 文本</summary><textarea aria-label="简历 OCR 文本" className="question-input" value={ocrText} onChange={(event) => setOcrText(event.target.value)} placeholder="扫描件可粘贴外部 OCR 结果，用于本次分析。" rows={4} disabled={busy} /></details>
          <button className="run-agent-button" onClick={() => void analyze()} disabled={busy || batchBusy || !health?.agent || !question.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy ? "Agent 正在分析" : "开始分析"}
          </button>
          {busy && <><button className="stop-agent-button" onClick={stopAnalysis}>停止分析</button><div className="analysis-progress" role="status"><strong>{analysisProgress?.message || "正在处理分析请求。"}</strong><span>已用时 {analysisElapsed} 秒</span>{Boolean(analysisProgress?.total) && <progress className="research-progress" max={analysisProgress!.total} value={analysisProgress!.completed ?? 0} aria-label="分析进度" />}</div></>}
          {analysisDebug && <details className="analysis-debug-panel"><summary>Agent 调试计时 · 并发峰值 {analysisDebug.maxParallel} · 总计 {analysisDebug.totalDurationMs} ms</summary><div className="analysis-debug-table">{[...analysisDebug.timings].sort((a, b) => a.startedAtMs - b.startedAtMs).map((timing) => <div className="analysis-debug-row" key={`${timing.id}-${timing.stage}`}><strong>{timing.label}</strong><span>{timing.durationMs} ms</span><small>阶段 {timing.stage + 1}{timing.parallelWith.length ? ` · 并行：${timing.parallelWith.join("、")}` : " · 串行"}</small></div>)}</div></details>}
          {!selected.assessment && <div className="scoring-settings">
            <div className="scoring-settings-head"><div><span className="eyebrow">SCORE SETTINGS</span><strong>评分权重</strong></div><span>{weightSaving ? "保存中" : `${Object.values(weights).reduce((sum, value) => sum + value, 0)}%`}</span></div>
            {scoreCriteria.map(({ key, label }) => <label className="weight-row" key={key}><span>{label}</span><input type="number" min="0" max="100" value={weights[key]} onChange={(event) => { setWeights({ ...weights, [key]: Number(event.target.value) } as ScoreWeights); setWeightProposal(null); setWeightError(""); }} onBlur={() => updateWeights(weights)} /><span>%</span></label>)}
            <div className="weight-agent"><input value={weightInstruction} onChange={(event) => { setWeightInstruction(event.target.value); setWeightProposal(null); setWeightError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); adjustWeightsWithAgent(); } }} placeholder="让 AI 调整，例如：更看重专业能力和岗位契合度" /><button title="生成权重调整方案" aria-label="生成权重调整方案" onClick={adjustWeightsWithAgent} disabled={weightBusy || weightSaving || !health?.agent}>{weightBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}</button></div>
            {weightError && <div className="inline-error">{weightError}</div>}
            {weightProposal && weightImpact && <WeightProposalPreview proposal={weightProposal} currentWeights={weights} impact={weightImpact} selectedHasScoreCard={hasAgentScore(selected)} onDiscard={() => setWeightProposal(null)} onApply={() => updateWeights(weightProposal.weights)} busy={weightSaving} />}
          </div>}
          {!health?.agent && <div className="setup-hint"><span className="setup-icon"><CircleHelp size={15} /></span><span>配置服务密钥后可生成 AI 文字报告；材料评分可直接使用规则抽取。<code>OPENAI_API_KEY</code>{health ? "" : " · 服务连接中"}</span></div>}

        </aside>
            </>}
      </div>
    </div>
  );
}
