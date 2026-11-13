import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowDown,
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
import { sampleResumes } from "./sample-resumes";
import type { Resume } from "./types";
import { calculateComposite, defaultScoreWeights, normalizeWeights, scoreCriteria, type ComparisonRankCriterion, type ComparisonRankDraft, type ComparisonRatingFilter, type ScoreCard, type ScoreKey, type ScoreWeights } from "../shared/scoring";
import { calculateBenchmark, historicalCandidates, historicalScoreBands, matchesHistoricalFilters, roleGroup, roleGroupLabel, type HistoricalCandidate, type HistoricalFilterDraft, type HistoricalOutcomeFilter, type HistoricalScoreBandKey } from "../shared/history";
import { findKnowledgeMatch, findKnowledgeReferences, getKnowledgeReadiness, knowledgeEvidenceSourceTypeLabels, knowledgeKindLabels, knowledgeReadinessStages, knowledgeRecords as seedKnowledgeRecords, knowledgeScoreBands, summarizeKnowledgeReadiness, summarizeKnowledgeScoreBands, type KnowledgeEvidenceFilter, type KnowledgeEvidenceSource, type KnowledgeEvidenceSourceType, type KnowledgeFilterDraft, type KnowledgeImportBundle, type KnowledgeKind, type KnowledgeReadiness, type KnowledgeRecord, type KnowledgeReviewEntry, type KnowledgeReviewFilter, type KnowledgeScoreBand, type KnowledgeSort, type KnowledgeVerificationFilter } from "../shared/knowledge";

type AgentHealth = { agent: boolean; webSearch: boolean; model: string };
type KnowledgeSource = { title: string; url: string; snippet: string };
type KnowledgeReviewSuggestion = { score: number; rationale: string };
type KnowledgeImportPreview = { bundle: KnowledgeImportBundle; insertCount: number; updateCount: number; insertReviewCount: number; updateReviewCount: number };
type RoleProfileProposal = { requirements: string; rationale: string };
type AnalysisTaskProposal = { question: string; rationale: string };
type WeightProposal = { weights: ScoreWeights; rationale: string };
type WeightImpact = { currentScore: number; proposedScore: number; currentRank: number; proposedRank: number; total: number; demoCount: number };

type ResumeListResponse = { resumes: Resume[]; directory: string };
type PdfTextLine = { id: string; page: number; text: string; x: number; y: number; width: number; height: number; angle: number };
const awardPattern = /(奖|获奖|award|acm|icpc|ccf|竞赛|比赛|金牌|银牌|铜牌|一等奖|二等奖|三等奖|优胜奖|冠军|亚军|季军|csp)/i;
function normalizeEvidence(value: string): string { return value.toLocaleLowerCase().replace(/[\s\u3000]+/g, "").replace(/[，。；：、“”‘’（）()【】[\],.:;!?！？]/g, ""); }
function renderEvidenceText(value: string, query: string) {
  const target = query.trim();
  const index = target ? value.toLocaleLowerCase().indexOf(target.toLocaleLowerCase()) : -1;
  if (index < 0) return value;
  return <>{value.slice(0, index)}<mark className="sample-evidence-hit">{value.slice(index, index + target.length)}</mark>{value.slice(index + target.length)}</>;
}

function PdfReader({ url, title, evidenceTarget, onEvidenceResult }: { url: string; title: string; evidenceTarget: string; onEvidenceResult: (result: { query: string; page: number | null }) => void }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [textLines, setTextLines] = useState<PdfTextLine[]>([]);
  const [awardLines, setAwardLines] = useState<PdfTextLine[]>([]);
  const [showAwardMask, setShowAwardMask] = useState(true);
  const [evidenceLineIds, setEvidenceLineIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
    setDocument(null);
    setPageNumber(1);
    setZoom(1);
    setTextLines([]);
    setAwardLines([]);
    setEvidenceLineIds([]);
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
        const detected: PdfTextLine[] = [];
        const pageTextLines: PdfTextLine[] = [];
        for (let currentPage = 1; currentPage <= document.numPages; currentPage += 1) {
          if (cancelled) return;
          const page = await document.getPage(currentPage);
          const textContent = await page.getTextContent();
          const pageElement = pageRefs.current[currentPage - 1];
          const canvas = pageElement?.querySelector("canvas");
          const context = canvas?.getContext("2d");
          if (!canvas || !context) throw new Error("浏览器无法创建 PDF 阅读画布。");
          const viewport = page.getViewport({ scale: zoom });
          const outputScale = window.devicePixelRatio || 1;
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
              width: Math.max(1, rawItem.width * zoom),
              height,
              angle: Math.atan2(transform[1], transform[0]),
            };
            textLines.push(line);
            pageTextLines.push(line);
            if (awardPattern.test(text)) detected.push(line);
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
        }
        if (!cancelled) {
          setTextLines(pageTextLines);
          setAwardLines(detected);
        }
        if (!cancelled) setLoading(false);
      } catch (cause) {
        if (!cancelled && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
          setError(cause instanceof Error ? cause.message : "无法渲染 PDF 页面。");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  }, [document, zoom]);

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
      <div className="pdf-viewer-toolbar">
        <div className="pdf-page-controls">
          <button className="reader-button" onClick={() => goToPage(pageNumber - 1)} disabled={!document || pageNumber <= 1} title="向上翻页" aria-label="向上翻页"><ArrowUp size={15} /></button>
          <span className="page-indicator">{loading ? "读取中" : `${pageNumber} / ${document?.numPages ?? 0}`}</span>
          <button className="reader-button" onClick={() => goToPage(pageNumber + 1)} disabled={!document || pageNumber >= (document?.numPages ?? 1)} title="向下翻页" aria-label="向下翻页"><ArrowDown size={15} /></button>
        </div>
        <div className="pdf-zoom-controls">
          <button className="reader-button" onClick={() => setZoom((current) => Math.max(0.6, Math.round((current - 0.1) * 10) / 10))} disabled={zoom <= 0.6} title="缩小" aria-label="缩小"><Minus size={15} /></button>
          <span className="zoom-indicator">{Math.round(zoom * 100)}%</span>
          <button className="reader-button" onClick={() => setZoom((current) => Math.min(2, Math.round((current + 0.1) * 10) / 10))} disabled={zoom >= 2} title="放大" aria-label="放大"><Plus size={15} /></button>
        </div>
        <a className="reader-button download-link" href={url} download={title} title="下载 PDF" aria-label="下载 PDF"><ArrowDownToLine size={15} /></a>
      </div>
      <label className="award-mask-toggle" title="显示或隐藏当前 PDF 中全部奖项标注">
        <span className="award-swatch" />
        <span>奖项标注</span>
        <span className="award-count">{awardLines.length}</span>
        <input className="switch-input" type="checkbox" role="switch" aria-label="显示奖项标注" checked={showAwardMask} onChange={(event) => setShowAwardMask(event.target.checked)} />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      </label>
      <div ref={viewerRef} className="pdf-canvas-wrap" onScroll={handleScroll}>
        {loading && <div className="reader-message"><LoaderCircle className="spin" size={18} />正在打开 PDF</div>}
        {error && <div className="reader-error">{error}</div>}
        {document && !error && Array.from({ length: document.numPages }, (_, index) => (
          <div className="pdf-page" key={index} ref={(element) => { pageRefs.current[index] = element; }} data-page={index + 1}>
            <div className="pdf-page-label">第 {index + 1} 页</div>
            <div className="pdf-page-content">
              <canvas className="pdf-canvas" aria-label={`${title} 第 ${index + 1} 页`} />
              <div className={`pdf-text-layer ${showAwardMask ? "awards-visible" : ""}`} aria-label="奖项文字标注覆盖层">
                {textLines.filter((line) => line.page === index + 1).map((line) => <span id={`pdf-text-${line.id}`} data-evidence-hit={evidenceLineIds.includes(line.id) || undefined} className={`pdf-text-item ${showAwardMask && awardPattern.test(line.text) ? "award-hit" : ""}`} key={line.id} style={{ left: line.x, top: line.y, width: line.width, height: line.height, fontSize: line.height, transform: `rotate(${line.angle}rad)` }}>{line.text}</span>)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type ProjectBreakdown = { title: string; plainTitle: string; goal: string; actions: string; outcome: string };

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
    return { title: `${experience.company} · ${experience.role}`, plainTitle: translateRecruitingTerms(experience.role), goal: `在 ${experience.company} 负责与岗位相关的工作`, actions: translateRecruitingTerms(sentences.slice(0, 1).join("；") || experience.detail), outcome: translateRecruitingTerms(sentences.slice(1).join("；") || "简历未明确写出量化结果") };
  });
  const chunks = candidate.text.split(/[。；\n]/).map((item) => item.trim()).filter((item) => /负责|主导|搭建|优化|项目|交付|提升|降低/.test(item));
  return chunks.slice(0, 4).map((chunk, index) => ({ title: `简历项目 ${index + 1}`, plainTitle: "把这段经历拆成可核对的工作任务", goal: "候选人希望解决的业务或技术问题（需人工核实）", actions: translateRecruitingTerms(chunk), outcome: "简历未明确写出量化结果" }));
}

function KnowledgeReferenceBar({ candidate, records, onOpen }: { candidate: Resume; records: KnowledgeRecord[]; onOpen: (id?: string) => void }) {
  const references = findKnowledgeReferences(candidate.text, records);
  return <section className="knowledge-reference-bar"><div><span className="eyebrow">CROSS REFERENCES</span><strong>资料库交叉引用</strong><small>只根据简历原文中的名称或别名匹配</small></div><div className="knowledge-reference-list">{references.length ? references.map((record) => <button key={record.id} onClick={() => onOpen(record.id)}><span className={`knowledge-reference-dot ${record.kind}`} />{record.title}<b>{record.significanceScore}</b></button>) : <span className="knowledge-reference-empty">未识别资料</span>}<button className="knowledge-reference-search" onClick={() => onOpen()}>打开资料库 <ExternalLink size={12} /></button></div></section>;
}

function radarPoint(index: number, value: number, radius: number, center: number): string {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / scoreCriteria.length;
  return `${center + Math.cos(angle) * radius * value / 100},${center + Math.sin(angle) * radius * value / 100}`;
}

function ScoreRadar({ card, selectedKey, onSelect }: { card: ScoreCard; selectedKey: ScoreKey | null; onSelect: (key: ScoreKey) => void }) {
  const center = 96;
  const radius = 67;
  const outer = scoreCriteria.map((_, index) => radarPoint(index, 100, radius, center)).join(" ");
  const values = scoreCriteria.map(({ key }) => card.criteria[key].score);
  const area = values.map((value, index) => radarPoint(index, value, radius, center)).join(" ");
  return <div className="score-radar"><svg viewBox="0 0 192 192" role="group" aria-label="六项能力雷达图，选择维度查看评分依据"> <polygon points={outer} className="radar-grid" />{[25, 50, 75].map((level) => <polygon key={level} points={scoreCriteria.map((_, index) => radarPoint(index, level, radius, center)).join(" ")} className="radar-ring" />)}{scoreCriteria.map((_, index) => <line key={index} x1={center} y1={center} x2={radarPoint(index, 100, radius, center).split(",")[0]} y2={radarPoint(index, 100, radius, center).split(",")[1]} className="radar-axis" />)}<polygon points={area} className="radar-area" />{values.map((value, index) => { const [x, y] = radarPoint(index, value, radius, center).split(","); const criterion = scoreCriteria[index]; return <circle key={criterion.key} cx={x} cy={y} r="5" className={`radar-dot ${selectedKey === criterion.key ? "selected" : ""}`} role="button" tabIndex={0} aria-label={`${criterion.label} ${value.toFixed(0)} 分，查看评分依据`} aria-pressed={selectedKey === criterion.key} onClick={() => onSelect(criterion.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(criterion.key); } }}><title>{`${criterion.label} ${value.toFixed(0)} 分 · 查看评分依据`}</title></circle>; })}</svg><div className="radar-labels">{scoreCriteria.map(({ key, label }, index) => <button type="button" key={key} className={`radar-label radar-label-${index} ${selectedKey === key ? "selected" : ""}`} aria-pressed={selectedKey === key} onClick={() => onSelect(key)}>{label}<b>{card.criteria[key].score.toFixed(0)}</b></button>)}</div></div>;
}

function ScoreContribution({ card, selectedKey, onSelect }: { card: ScoreCard; selectedKey: ScoreKey | null; onSelect: (key: ScoreKey) => void }) {
  const totalWeight = scoreCriteria.reduce((sum, criterion) => sum + card.weights[criterion.key], 0) || 100;
  return <section className="score-contribution"><div className="insight-section-head"><div><span className="eyebrow">SCORE DECOMPOSITION</span><h4>综合分贡献拆解</h4></div><span className="score-formula">按当前权重</span></div><div className="contribution-list">{scoreCriteria.map(({ key, label }) => { const criterion = card.criteria[key]; const contribution = criterion.score * card.weights[key] / totalWeight; return <button type="button" className={`contribution-row ${selectedKey === key ? "selected" : ""}`} key={key} aria-pressed={selectedKey === key} onClick={() => onSelect(key)} aria-label={`${label}，单项 ${criterion.score.toFixed(0)} 分，贡献 ${contribution.toFixed(1)} 分，点击查看评分依据`}><div className="contribution-row-head"><span>{label}</span><strong>{contribution.toFixed(1)} 分</strong><small>权重 {card.weights[key]}% · 置信度 {Math.round(criterion.confidence * 100)}%</small></div><div className="contribution-track"><i style={{ width: `${criterion.score}%` }} /><b style={{ left: `${criterion.score}%` }} /></div></button>; })}</div><p className="contribution-note">条形长度表示单项评分，右侧贡献值表示该项进入综合分后的实际影响；两者不要混为同一个分数。</p></section>;
}

function ScoreTrend({ card, candidate, onEvidence }: { card: ScoreCard; candidate: Resume; onEvidence: (evidence: string) => void }) {
  const history = candidate.scoreHistory?.length ? candidate.scoreHistory : candidate.scoreCard ? [{ id: `legacy-${candidate.scoreCard.evaluatedAt}`, evaluatedAt: candidate.scoreCard.evaluatedAt, reason: "import" as const, scoreCard: candidate.scoreCard }] : [];
  const [selectedId, setSelectedId] = useState(history.at(-1)?.id ?? "");
  const [focusedCriterion, setFocusedCriterion] = useState<ScoreKey | null>(null);
  const selected = history.find((entry) => entry.id === selectedId) ?? history.at(-1);
  const selectedIndex = selected ? history.findIndex((entry) => entry.id === selected.id) : -1;
  const previous = selectedIndex > 0 ? history[selectedIndex - 1] : null;
  useEffect(() => { setSelectedId(history.at(-1)?.id ?? ""); setFocusedCriterion(null); }, [candidate.id, history.length]);
  const chartWidth = Math.max(260, history.length * 48 + 24);
  const x = (index: number) => history.length < 2 ? chartWidth / 2 : 34 + (index / (history.length - 1)) * (chartWidth - 52);
  const y = (score: number) => 104 - (score / 100) * 72;
  const points = history.map((entry, index) => `${x(index)},${y(entry.scoreCard.composite)}`).join(" ");
  const focus = focusedCriterion && selected ? selected.scoreCard.criteria[focusedCriterion] : null;
  return <div className="score-trend">
    <div className="trend-legend"><span>综合分复评记录</span><small>当前综合分 {card.composite.toFixed(1)} · 历史点按当时权重保存</small></div>
    {history.length ? <>
      <div className="trend-chart-scroll"><svg viewBox={`0 0 ${chartWidth} 142`} style={{ width: `${chartWidth}px` }} role="img" aria-label="按实际评估时间排列的综合分历史折线图">
        {[0, 50, 100].map((tick) => <g key={tick}><line x1="28" y1={y(tick)} x2={chartWidth - 12} y2={y(tick)} className="trend-grid" /><text x="23" y={y(tick) + 3} textAnchor="end" className="trend-label">{tick}</text></g>)}
        <line x1="28" y1="104" x2={chartWidth - 12} y2="104" className="trend-axis" />
        {history.length > 1 && <polyline points={points} className="trend-line" />}
        {history.map((entry, index) => {
          const date = new Date(entry.evaluatedAt);
          const label = Number.isNaN(date.getTime()) ? "未知日期" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
          const score = entry.scoreCard.composite;
          const active = entry.id === selected?.id;
          return <g key={entry.id} className={`trend-point ${active ? "active" : ""}`} role="button" tabIndex={0} aria-label={`${label}，${entry.reason === "import" ? "导入初评" : "复评"}，综合分 ${score.toFixed(1)}`} aria-pressed={active} onClick={() => { setSelectedId(entry.id); setFocusedCriterion(null); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(entry.id); setFocusedCriterion(null); } }}>
            <title>{`${label} · ${entry.reason === "import" ? "导入初评" : "复评"} · 综合分 ${score.toFixed(1)}`}</title>
            <circle cx={x(index)} cy={y(score)} r={active ? 5 : 4} className="trend-dot" />
            <text x={x(index)} y="124" textAnchor="middle" className="trend-label">{label}</text>
          </g>;
        })}
      </svg></div>
      {selected && <div className="trend-selection"><div className="trend-selection-head"><span>{selected.reason === "import" ? "导入初评" : "复评"} · {new Date(selected.evaluatedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</span><strong>{selected.scoreCard.composite.toFixed(1)} 分{previous && selectedIndex >= 0 ? <small className={selected.scoreCard.composite >= previous.scoreCard.composite ? "trend-up" : "trend-down"}>{selected.scoreCard.composite >= previous.scoreCard.composite ? "+" : ""}{(selected.scoreCard.composite - previous.scoreCard.composite).toFixed(1)}</small> : null}</strong></div>
        <div className="trend-criteria">{scoreCriteria.map(({ key, label }) => { const criterion = selected.scoreCard.criteria[key]; return <button key={key} className={focusedCriterion === key ? "focused" : ""} onClick={() => setFocusedCriterion(focusedCriterion === key ? null : key)}><span>{label}</span><i><b style={{ width: `${criterion.score}%` }} /></i><strong>{criterion.score.toFixed(0)}</strong></button>; })}</div>
        {selected.roleRequirements && <div className="trend-role-context"><strong>当时的岗位要求</strong><span>{selected.roleRequirements}</span></div>}
        {focus && focusedCriterion && <div className="trend-evidence"><strong>{scoreCriteria.find((item) => item.key === focusedCriterion)?.label} · 评分依据</strong>{focus.evidence.length ? focus.evidence.map((item, index) => <button key={`${index}-${item}`} onClick={() => onEvidence(item)} title="在简历原文中定位这条依据">{item}<ExternalLink size={10} /></button>) : <span>本次评估未提取到明确证据</span>}</div>}
        <small className="trend-weight-note">按该次评估保存的权重计算，旧记录不会随当前权重变化而重算。</small>
      </div>}
    </> : <div className="trend-empty"><strong>{candidate.source === "demo" ? "示例简历没有真实评估历史" : "尚无评分记录"}</strong><span>{candidate.source === "demo" ? "导入 PDF 并完成分析后，这里会显示实际评估结果。" : "导入初评会记录第一个分数；后续复评后形成真实趋势。"}</span></div>}
  </div>;
}

function ProjectBreakdownView({ candidate }: { candidate: Resume }) {
  const projects = deriveProjects(candidate);
  return <section className="project-breakdown"><div className="insight-section-head"><div><span className="eyebrow">PROJECT BREAKDOWN</span><h4>项目拆解 · 人话版</h4></div><span>{projects.length} 项</span></div>{projects.length ? projects.map((project) => <article className="project-item" key={project.title}><div className="project-title"><strong>{project.plainTitle}</strong><span>{project.title}</span></div><dl><div><dt>要解决什么</dt><dd>{project.goal}</dd></div><div><dt>具体做了什么</dt><dd>{project.actions}</dd></div><div><dt>带来什么结果</dt><dd>{project.outcome}</dd></div></dl></article>) : <p className="project-empty">当前简历没有足够的项目描述，建议在面试中追问目标、个人贡献和结果。</p>}</section>;
}

function BenchmarkBadge({ role, score, candidates }: { role: string; score: number; candidates: HistoricalCandidate[] }) {
  const [year, setYear] = useState<number | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const benchmark = calculateBenchmark(role, score, year, candidates);
  useEffect(() => { setYear(null); setSelectedHistoryId(null); }, [role]);
  const selectedHistory = benchmark.candidates.find((candidate) => candidate.id === selectedHistoryId);
  const lanes = [
    { key: "hired", label: "最终录取", candidates: benchmark.candidates.filter((candidate) => candidate.hired) },
    { key: "screened", label: "首轮通过", candidates: benchmark.candidates.filter((candidate) => candidate.screened && !candidate.hired) },
    { key: "rejected", label: "未过首轮", candidates: benchmark.candidates.filter((candidate) => !candidate.screened) },
  ];
  const selectCandidate = (candidate: (typeof benchmark.candidates)[number]) => setSelectedHistoryId(candidate.id);
  return <section className="benchmark-card">
    <div className="benchmark-head"><div><span className="eyebrow">HISTORICAL BENCHMARK</span><div className="benchmark-percentile"><strong>超过历史样本 {benchmark.percentile}%</strong><span>{roleGroupLabel(benchmark.roleGroup)}岗位族 · {benchmark.sampleCount} 份</span></div></div><div className="benchmark-year-filter" role="group" aria-label="筛选历史样本年份"><button className={year === null ? "active" : ""} onClick={() => { setYear(null); setSelectedHistoryId(null); }}>全部</button>{benchmark.availableYears.map((value) => <button className={year === value ? "active" : ""} key={value} onClick={() => { setYear(value); setSelectedHistoryId(null); }}>{value}</button>)}</div></div>
    <div className="benchmark-distribution" role="group" aria-label="历史候选人综合分分布图">
      <div className="benchmark-overlay" aria-hidden="true"><i className="benchmark-current-line" style={{ left: `${score}%` }}><b>当前 {score.toFixed(0)}</b></i><i className="benchmark-screen-line" style={{ left: `${benchmark.screenCutoff}%` }} /><i className="benchmark-hire-line" style={{ left: `${benchmark.hireCutoff}%` }} /></div>
      {lanes.map((lane) => <div className="benchmark-lane" key={lane.key}><span className="benchmark-lane-label">{lane.label}</span><div className={`benchmark-lane-track ${lane.key}`}>{lane.candidates.map((candidate) => <button key={candidate.id} className={`benchmark-dot ${selectedHistoryId === candidate.id ? "selected" : ""}`} style={{ left: `${candidate.composite}%` }} title={`${candidate.year} · ${candidate.name} · ${candidate.composite} 分`} aria-label={`${candidate.year} ${candidate.name}，综合分 ${candidate.composite}，${candidate.screened ? "通过首轮" : "未通过首轮"}${candidate.hired ? "，最终录取" : ""}`} aria-pressed={selectedHistoryId === candidate.id} onClick={() => selectCandidate(candidate)} />)}</div></div>)}
      <div className="benchmark-axis"><span /><div><i>0</i><i>25</i><i>50</i><i>75</i><i>100</i></div></div>
    </div>
    <div className="benchmark-legend"><span><i className="legend-current" />当前候选人</span><span><i className="legend-screen" />首轮参考线 {benchmark.screenCutoff}</span><span><i className="legend-hire" />录取参考线 {benchmark.hireCutoff}</span><span><i className="legend-sample" />历史记录</span></div>
    {selectedHistory && <div className="benchmark-selected"><strong>{selectedHistory.name}</strong><span>{selectedHistory.year} 年 · {selectedHistory.composite} 分 · {selectedHistory.screened ? "通过首轮" : "未通过首轮"} · {selectedHistory.hired ? "最终录取" : "未录取"}</span><button onClick={() => setSelectedHistoryId(null)} aria-label="关闭历史样本详情"><X size={12} /></button></div>}
    <div className="benchmark-stats"><div><span>历史首轮通过率</span><strong>{benchmark.screenedRate}%</strong></div><div><span>历史录取率</span><strong>{benchmark.hiredRate}%</strong></div><div><span>首轮参考分数</span><strong>{benchmark.screenCutoff}</strong></div><div><span>录取参考分数</span><strong>{benchmark.hireCutoff}</strong></div></div>
    <p>本地演示样本仅用于说明比较方式，不代表真实招聘结果；百分位和参考线均为辅助信息。</p>
  </section>;
}

type HistoricalDraft = { name: string; role: string; year: number; composite: number; screened: boolean; hired: boolean };
const emptyHistoricalDraft = (): HistoricalDraft => ({ name: "匿名样本", role: "", year: new Date().getFullYear(), composite: 70, screened: false, hired: false });

function HistoricalDatabaseView({ candidates, onCandidatesChange, onClose, agentAvailable }: { candidates: HistoricalCandidate[]; onCandidatesChange: (candidates: HistoricalCandidate[]) => void; onClose: () => void; agentAvailable: boolean }) {
  const [roleFilter, setRoleFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [scoreBandFilter, setScoreBandFilter] = useState<HistoricalScoreBandKey | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<HistoricalOutcomeFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<HistoricalDraft>(emptyHistoricalDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState("");
  const [filterInstruction, setFilterInstruction] = useState("");
  const [filterProposal, setFilterProposal] = useState<HistoricalFilterDraft | null>(null);
  const [filterAssistantBusy, setFilterAssistantBusy] = useState(false);
  const [filterAssistantError, setFilterAssistantError] = useState("");
  const groups = [...new Set(candidates.map((candidate) => roleGroup(candidate.role)))].sort();
  const years = [...new Set(candidates.map((candidate) => candidate.year))].sort((a, b) => b - a);
  const baseFiltered = candidates.filter((candidate) => (roleFilter === "all" || roleGroup(candidate.role) === roleFilter) && (yearFilter === "all" || candidate.year === Number(yearFilter)));
  const filtered = baseFiltered.filter((candidate) => matchesHistoricalFilters(candidate, scoreBandFilter, outcomeFilter));
  const selected = filtered.find((candidate) => candidate.id === selectedId) ?? filtered[0] ?? null;
  const screenedCount = filtered.filter((candidate) => candidate.screened).length;
  const hiredCount = filtered.filter((candidate) => candidate.hired).length;
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : 0; };
  const lanes = [
    { key: "hired", label: "最终录取", records: filtered.filter((candidate) => candidate.hired) },
    { key: "screened", label: "通过首轮", records: filtered.filter((candidate) => candidate.screened && !candidate.hired) },
    { key: "rejected", label: "未过首轮", records: filtered.filter((candidate) => !candidate.screened) },
  ];
  const maxBandCount = Math.max(1, ...historicalScoreBands.map((band) => baseFiltered.filter((candidate) => candidate.composite >= band.min && candidate.composite <= band.max).length));
  const outcomeLabels: Record<HistoricalOutcomeFilter, string> = { all: "全部结果", hired: "最终录取", screened: "首轮通过", rejected: "未过首轮" };
  const filterSummary = [scoreBandFilter ? `${historicalScoreBands.find((band) => band.key === scoreBandFilter)?.label} 分` : "", outcomeFilter !== "all" ? outcomeLabels[outcomeFilter] : ""].filter(Boolean).join(" · ");

  function beginAdd() { setEditingId(""); setDraft(emptyHistoricalDraft()); setError(""); setFormOpen(true); }
  function beginEdit(candidate: HistoricalCandidate) {
    if (candidate.source !== "local") return;
    setEditingId(candidate.id); setDraft({ name: candidate.name, role: candidate.role, year: candidate.year, composite: candidate.composite, screened: candidate.screened, hired: candidate.hired }); setError(""); setFormOpen(true);
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(editingId ? `/api/resumes/history/${encodeURIComponent(editingId)}` : "/api/resumes/history", { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法保存历史样本。");
      const candidate = payload.candidate as HistoricalCandidate;
      onCandidatesChange(editingId ? candidates.map((item) => item.id === editingId ? candidate : item) : [...candidates, candidate]);
      setSelectedId(candidate.id); setEditingId(""); setDraft(emptyHistoricalDraft()); setFormOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存历史样本。"); }
    finally { setBusy(false); }
  }
  async function remove(candidate: HistoricalCandidate) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/resumes/history/${encodeURIComponent(candidate.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法删除历史样本。");
      const remaining = candidates.filter((item) => item.id !== candidate.id);
      onCandidatesChange(remaining); setDeleteTargetId(""); if (selectedId === candidate.id) setSelectedId(remaining[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除历史样本。"); }
    finally { setBusy(false); }
  }

  async function proposeFilters() {
    setFilterAssistantBusy(true); setFilterAssistantError(""); setFilterProposal(null);
    try {
      const response = await fetch("/api/resumes/history/filter-draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: filterInstruction }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法生成筛选草案。");
      setFilterProposal(payload.suggestion as HistoricalFilterDraft);
    } catch (cause) { setFilterAssistantError(cause instanceof Error ? cause.message : "无法生成筛选草案。"); }
    finally { setFilterAssistantBusy(false); }
  }

  function applyFilterProposal() {
    if (!filterProposal) return;
    setRoleFilter(filterProposal.roleGroup);
    setYearFilter(String(filterProposal.year));
    setScoreBandFilter(filterProposal.scoreBand === "all" ? null : filterProposal.scoreBand);
    setOutcomeFilter(filterProposal.outcome);
    setSelectedId("");
    setFilterProposal(null);
  }

  return <main className="history-database-main">
    <div className="history-database-shell">
      <header className="history-database-header"><div><span className="eyebrow">LOCAL RECRUITING BENCHMARK</span><h2>历史招聘样本库</h2><p>只保存匿名样本的岗位、年份、综合分与筛选结果；本地录入可随时修改或删除。</p></div><button className="back-to-workspace" onClick={onClose}>返回简历分析</button></header>
      <section className="history-filter-assistant"><div className="history-filter-assistant-title"><div><Sparkles size={14} /><strong>自然语言筛选</strong></div><small>只发送筛选选项与指令，不发送样本记录</small></div><div className="history-filter-assistant-input"><input value={filterInstruction} onChange={(event) => { setFilterInstruction(event.target.value); setFilterProposal(null); setFilterAssistantError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void proposeFilters(); } }} placeholder="例如：看 2025 年高分的产品岗位最终录取样本" aria-label="描述要查找的历史样本" /><button type="button" onClick={() => void proposeFilters()} disabled={!agentAvailable || filterAssistantBusy || !filterInstruction.trim()} title={agentAvailable ? "生成筛选方案" : "请先配置模型服务"}>{filterAssistantBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{filterAssistantBusy ? "整理中" : "生成方案"}</button></div>{filterAssistantError && <div className="inline-error">{filterAssistantError}</div>}{filterProposal && <div className="history-filter-proposal"><div><strong>筛选草案</strong><span>{filterProposal.rationale}</span><small>{filterProposal.roleGroup === "all" ? "全部岗位" : roleGroupLabel(filterProposal.roleGroup)} · {filterProposal.year === "all" ? "全部年份" : filterProposal.year} · {filterProposal.scoreBand === "all" ? "全部分数" : `${historicalScoreBands.find((band) => band.key === filterProposal.scoreBand)?.label} 分`} · {outcomeLabels[filterProposal.outcome]}</small></div><div><button type="button" onClick={() => setFilterProposal(null)}>放弃</button><button type="button" onClick={applyFilterProposal}>应用筛选</button></div></div>}</section>
      <section className="history-database-summary"><div><span>当前样本</span><strong>{filtered.length}</strong></div><div><span>首轮通过</span><strong>{filtered.length ? Math.round(screenedCount / filtered.length * 100) : 0}%</strong></div><div><span>最终录取</span><strong>{filtered.length ? Math.round(hiredCount / filtered.length * 100) : 0}%</strong></div><div><span>综合分中位数</span><strong>{median(filtered.map((candidate) => candidate.composite)).toFixed(1)}</strong></div><small>当前筛选范围 · 演示样本与本地样本分开标记</small></section>
      <section className="history-database-chart"><div className="history-database-section-head"><div><span className="eyebrow">SCORE DISTRIBUTION</span><h3>按招聘结果查看分数</h3></div><div className="history-database-filters"><label>岗位<select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setScoreBandFilter(null); setSelectedId(""); }}><option value="all">全部岗位族</option>{groups.map((group) => <option key={group} value={group}>{roleGroupLabel(group)}</option>)}</select></label><label>年份<select value={yearFilter} onChange={(event) => { setYearFilter(event.target.value); setScoreBandFilter(null); setSelectedId(""); }}><option value="all">全部年份</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label></div></div>
        <div className="history-score-distribution"><div className="history-score-distribution-head"><strong>分数区间</strong><span>{filterSummary ? `当前筛选 ${filterSummary} · ${filtered.length} 份` : "点击区间或结果筛选样本"}</span></div><div className="history-score-bins">{historicalScoreBands.map((band) => { const bandRecords = baseFiltered.filter((candidate) => candidate.composite >= band.min && candidate.composite <= band.max); const hired = bandRecords.filter((candidate) => candidate.hired).length; const screened = bandRecords.filter((candidate) => candidate.screened && !candidate.hired).length; const rejected = bandRecords.length - hired - screened; return <button type="button" key={band.key} className={scoreBandFilter === band.key ? "active" : ""} disabled={!bandRecords.length} aria-pressed={scoreBandFilter === band.key} aria-label={`${band.label} 分区间：${bandRecords.length} 份，最终录取 ${hired} 份，首轮通过 ${screened} 份，未过首轮 ${rejected} 份`} onClick={() => { setScoreBandFilter((current) => current === band.key ? null : band.key); setSelectedId(""); }}><span className="history-score-bin-label">{band.label}</span><strong>{bandRecords.length}<small>份</small></strong><span className="history-score-bin-track"><i style={{ width: `${bandRecords.length / maxBandCount * 100}%` }}><b className="hired" style={{ width: `${bandRecords.length ? hired / bandRecords.length * 100 : 0}%` }} /><b className="screened" style={{ width: `${bandRecords.length ? screened / bandRecords.length * 100 : 0}%` }} /><b className="rejected" style={{ width: `${bandRecords.length ? rejected / bandRecords.length * 100 : 0}%` }} /></i></span><small className="history-score-bin-detail">录取 {hired} · 首轮 {screened} · 未过 {rejected}</small></button>; })}</div><div className="history-score-outcome-filter" role="group" aria-label="按招聘结果筛选">{(Object.keys(outcomeLabels) as HistoricalOutcomeFilter[]).map((outcome) => <button type="button" key={outcome} className={outcomeFilter === outcome ? "active" : ""} aria-pressed={outcomeFilter === outcome} onClick={() => { setOutcomeFilter(outcome); setSelectedId(""); }}>{outcome !== "all" && <i className={outcome} />}{outcomeLabels[outcome]}</button>)}</div></div>
        <div className="history-database-plot">{lanes.map((lane) => <div className="history-database-lane" key={lane.key}><span>{lane.label}<small>{lane.records.length}</small></span><div className={`history-database-track ${lane.key}`}>{lane.records.map((candidate) => <button key={candidate.id} className={`history-database-dot ${candidate.id === selected?.id ? "selected" : ""} ${candidate.source === "local" ? "local" : "demo"}`} style={{ left: `${candidate.composite}%` }} title={`${candidate.name} · ${candidate.role} · ${candidate.year} · ${candidate.composite} 分`} aria-label={`选中${candidate.name}，${candidate.year} 年${candidate.role}，${candidate.composite} 分，${lane.label}`} aria-pressed={candidate.id === selected?.id} onClick={() => setSelectedId(candidate.id)} />)}</div></div>)}<div className="history-database-axis"><span /><div><i>0</i><i>25</i><i>50</i><i>75</i><i>100</i></div></div></div>
        <div className="history-database-legend"><span><i className="demo" />演示样本</span><span><i className="local" />本地录入</span></div>
        {selected && <div className="history-database-selected"><strong>{selected.name}</strong><span>{selected.role} · {selected.year} · {selected.composite} 分 · {selected.screened ? "通过首轮" : "未过首轮"} · {selected.hired ? "最终录取" : "未录取"}</span><b>{selected.source === "local" ? "本地" : "演示"}</b></div>}
      </section>
      <section className="history-database-records"><div className="history-database-section-head"><div><span className="eyebrow">SAMPLE RECORDS</span><h3>样本记录</h3></div><button className="history-add-button" onClick={beginAdd}><Plus size={13} />新增本地样本</button></div>
        {formOpen && <form className="history-record-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><strong>{editingId ? "编辑本地样本" : "新增匿名样本"}</strong><label>匿名代号<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} placeholder="匿名样本" /></label><label>岗位名称<input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} maxLength={120} required placeholder="例如：产品经理" /></label><label>招聘年份<input type="number" min="1980" max={new Date().getFullYear() + 1} value={draft.year} onChange={(event) => setDraft({ ...draft, year: Number(event.target.value) })} required /></label><label>综合分<input type="number" min="0" max="100" step="0.1" value={draft.composite} onChange={(event) => setDraft({ ...draft, composite: Number(event.target.value) })} required /></label><label className="history-check-label"><input type="checkbox" checked={draft.screened} onChange={(event) => setDraft({ ...draft, screened: event.target.checked, hired: event.target.checked ? draft.hired : false })} />通过首轮</label><label className="history-check-label"><input type="checkbox" checked={draft.hired} onChange={(event) => setDraft({ ...draft, hired: event.target.checked, screened: event.target.checked || draft.screened })} />最终录取</label>{error && <div className="inline-error">{error}</div>}<div><button type="button" onClick={() => { setFormOpen(false); setEditingId(""); setDraft(emptyHistoricalDraft()); setError(""); }}>取消</button><button type="submit" disabled={busy || !draft.role.trim()}>{busy ? "保存中" : "保存样本"}</button></div></form>}
        <div className="history-record-list">{filtered.map((candidate) => <article className={`history-record-row ${candidate.id === selected?.id ? "selected" : ""}`} key={candidate.id}><div className="history-record-score"><strong>{candidate.composite.toFixed(1)}</strong><i><b style={{ width: `${candidate.composite}%` }} /></i></div><div className="history-record-identity"><button className="history-record-select" onClick={() => setSelectedId(candidate.id)}><strong>{candidate.name}<small className={candidate.source === "local" ? "local" : "demo"}>{candidate.source === "local" ? "本地" : "演示"}</small></strong><span>{candidate.role} · {candidate.year}</span></button></div><div className="history-record-outcome"><span>{candidate.screened ? "通过首轮" : "未过首轮"}</span><span>{candidate.hired ? "最终录取" : "未录取"}</span></div>{candidate.source === "local" ? <div className="history-record-actions"><button type="button" onClick={() => beginEdit(candidate)} title="编辑样本" aria-label={`编辑${candidate.name}`}><Pencil size={13} /></button>{deleteTargetId === candidate.id ? <><button type="button" onClick={() => void remove(candidate)} disabled={busy}>确认</button><button type="button" onClick={() => setDeleteTargetId("")}>取消</button></> : <button type="button" onClick={() => setDeleteTargetId(candidate.id)} title="删除样本" aria-label={`删除${candidate.name}`}><X size={13} /></button>}</div> : <span className="history-readonly">只读</span>}</article>)}{!filtered.length && <div className="empty-list">当前筛选没有历史样本</div>}</div>
      </section>
      <p className="history-database-disclaimer">演示样本为虚构数据。本地录入建议使用匿名代号；系统不保存历史简历 PDF、姓名、联系方式或简历正文。样本结果只用于辅助比较，不构成录用规则。</p>
    </div>
  </main>;
}

function ScoreInsights({ card, candidate, records, historyCandidates: historyRecords, onOpenKnowledge, onEvidence }: { card: ScoreCard; candidate: Resume; records: KnowledgeRecord[]; historyCandidates: HistoricalCandidate[]; onOpenKnowledge: (id?: string) => void; onEvidence: (evidence: string) => void }) {
  const [selectedCriterion, setSelectedCriterion] = useState<ScoreKey | null>(null);
  const selected = selectedCriterion ? card.criteria[selectedCriterion] : null;
  const selectedLabel = scoreCriteria.find((criterion) => criterion.key === selectedCriterion)?.label;
  useEffect(() => { setSelectedCriterion(null); }, [candidate.id]);
  return <div className="score-insights"><BenchmarkBadge role={candidate.role} score={card.composite} candidates={historyRecords} /><KnowledgeReferenceBar candidate={candidate} records={records} onOpen={onOpenKnowledge} /><section className="score-visuals"><div className="insight-section-head"><div><span className="eyebrow">CAPABILITY PROFILE</span><h4>能力画像</h4></div><span className="score-formula">综合分 {card.composite.toFixed(1)}</span></div><div className="score-visual-grid"><ScoreRadar card={card} selectedKey={selectedCriterion} onSelect={setSelectedCriterion} /><ScoreTrend card={card} candidate={candidate} onEvidence={onEvidence} /></div></section><ScoreContribution card={card} selectedKey={selectedCriterion} onSelect={setSelectedCriterion} />{selected && selectedCriterion && <section className="score-evidence-panel" aria-live="polite"><div><span className="eyebrow">SCORE EVIDENCE</span><strong>{selectedLabel} · {selected.score.toFixed(0)} 分</strong><small>评分置信度 {Math.round(selected.confidence * 100)}% · 点击依据回到 PDF 定位</small></div>{selected.evidence.length ? <ul>{selected.evidence.map((item, index) => <li key={`${index}-${item}`}><button type="button" onClick={() => onEvidence(item)} title="在简历原文中定位这条依据">{item}<ExternalLink size={11} /></button></li>)}</ul> : <p>本项没有提取到明确依据，建议结合简历原文人工复核。</p>}</section>}<ProjectBreakdownView candidate={candidate} /></div>;
}

function depthScore(card: ScoreCard): number {
  const keys: ScoreKey[] = ["leadership", "expertise", "experience", "roleFit", "growth"];
  return Math.round(keys.reduce((total, key) => total + card.criteria[key].score, 0) / keys.length * 10) / 10;
}

function RecruitmentQualityMap({ candidates, selectedId, onSelect, rankLabel, rankDirection }: { candidates: Array<{ resume: Resume; card: ScoreCard }>; selectedId: string; onSelect: (id: string) => void; rankLabel: string; rankDirection: "asc" | "desc" }) {
  const width = 620;
  const height = 320;
  const left = 56;
  const right = 24;
  const top = 28;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const pointX = (breadth: number) => left + (breadth / 100) * plotWidth;
  const pointY = (depth: number) => top + plotHeight - (depth / 100) * plotHeight;
  const mapCandidates = [...candidates.filter(({ resume }) => resume.id !== selectedId), ...candidates.filter(({ resume }) => resume.id === selectedId)];
  return <section className="quality-map-section"><div className="quality-map-head"><div><span className="eyebrow">RECRUITING QUALITY MAP</span><h3>招聘质量图 · 深度 × 广度</h3><p>横纵坐标表示经历广度与能力深度；点内序号对应当前排名，选中时显示姓名。</p></div><div className="quality-map-legend"><span className="quality-size-legend"><i className="quality-size-small" />50 分</span><span className="quality-size-legend"><i className="quality-size-large" />100 分</span><span className="quality-rank-context">气泡半径 = 综合分</span><span className="quality-rank-context">{rankLabel} · {rankDirection === "desc" ? "高分优先" : "低分优先"}</span></div></div><div className="quality-map-wrap"><svg className="quality-map" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`招聘质量深度广度散点图，序号按${rankLabel}${rankDirection === "desc" ? "高分优先" : "低分优先"}`}><rect x={left} y={top} width={plotWidth} height={plotHeight} className="quality-map-bg" /><rect x={left} y={top} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-learning" /><rect x={left + plotWidth / 2} y={top} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-deep" /><rect x={left} y={top + plotHeight / 2} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-narrow" /><rect x={left + plotWidth / 2} y={top + plotHeight / 2} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-broad" /><line x1={left + plotWidth / 2} y1={top} x2={left + plotWidth / 2} y2={top + plotHeight} className="quality-midline" /><line x1={left} y1={top + plotHeight / 2} x2={left + plotWidth} y2={top + plotHeight / 2} className="quality-midline" /><line x1={left} y1={top + plotHeight} x2={left + plotWidth} y2={top + plotHeight} className="quality-axis" /><line x1={left} y1={top} x2={left} y2={top + plotHeight} className="quality-axis" /><text x={left + plotWidth / 4} y={top + 18} className="quality-quadrant-label">待验证的成长型</text><text x={left + plotWidth * .75} y={top + 18} className="quality-quadrant-label">深度与广度兼具</text><text x={left + plotWidth / 4} y={top + plotHeight - 12} className="quality-quadrant-label">单一领域深耕</text><text x={left + plotWidth * .75} y={top + plotHeight - 12} className="quality-quadrant-label">广泛经历待聚焦</text>{[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={pointX(tick)} y1={top + plotHeight} x2={pointX(tick)} y2={top + plotHeight + 4} className="quality-axis" /><text x={pointX(tick)} y={height - 25} textAnchor="middle" className="quality-tick">{tick}</text><line x1={left - 4} y1={pointY(tick)} x2={left} y2={pointY(tick)} className="quality-axis" /><text x={left - 9} y={pointY(tick) + 3} textAnchor="end" className="quality-tick">{tick}</text></g>)}{mapCandidates.map(({ resume, card }) => { const index = candidates.findIndex((candidate) => candidate.resume.id === resume.id); const breadth = card.criteria.perspective.score; const depth = depthScore(card); const radius = 5 + card.composite / 10; const x = pointX(breadth); const y = pointY(depth); const active = resume.id === selectedId; const stableColor = [...resume.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4 + 1; const label = resume.name.length > 8 ? `${resume.name.slice(0, 8)}…` : resume.name; return <g key={resume.id} className={`quality-point ${active ? "selected" : ""}`} role="button" tabIndex={0} aria-pressed={active} aria-label={`排名第 ${index + 1}：${resume.name}，${rankLabel} ${rankDirection === "desc" ? "高分优先" : "低分优先"}，深度 ${depth.toFixed(0)}，广度 ${breadth.toFixed(0)}，综合分 ${card.composite.toFixed(1)}`} onClick={() => onSelect(resume.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(resume.id); } }}><title>{`第 ${index + 1} 名 · ${resume.name} · 深度 ${depth.toFixed(0)} · 广度 ${breadth.toFixed(0)} · 综合分 ${card.composite.toFixed(1)}`}</title><circle cx={x} cy={y} r={active ? radius + 2 : radius} className={`quality-bubble quality-bubble-${stableColor}`} /><text x={x} y={y + 3} textAnchor="middle" className="quality-rank-mark">{index + 1}</text>{active && <text x={x} y={y - radius - 7} textAnchor="middle" className="quality-name">{label}</text>}</g>; })}<text x={left + plotWidth / 2} y={height - 7} textAnchor="middle" className="quality-axis-label">经历广度（行业、领域、方法和团队经历）</text><text x="14" y={top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 14 ${top + plotHeight / 2})`} className="quality-axis-label">能力深度</text></svg></div><div className="quality-map-note"><span>深度 = 领导力、专业能力、经验、岗位契合度和进步分的平均值</span><span>广度 = 经历广度分</span><span>气泡半径固定映射 0–100 分；重叠候选人可在下方表格中选中</span></div></section>;
}

type KnowledgeDraft = { title: string; kind: KnowledgeKind; aliases: string; field: string; organizer: string; region: string; summary: string; signals: string; officialUrl: string; evidenceSources: KnowledgeEvidenceSource[] };
type KnowledgeDraftProposal = Omit<KnowledgeDraft, "title" | "kind" | "aliases" | "signals" | "evidenceSources"> & { aliases: string[]; signals: string[]; confidence: number; rationale: string; unknowns: string[]; sources: KnowledgeSource[]; searchStatus: "searched" | "no-results" | "not-configured" | "unavailable"; inputFingerprint: string };
const emptyKnowledgeDraft: KnowledgeDraft = { title: "", kind: "competition", aliases: "", field: "", organizer: "", region: "", summary: "", signals: "", officialUrl: "", evidenceSources: [] };

function KnowledgeReviewHistory({ history, sources }: { history: KnowledgeReviewEntry[]; sources: KnowledgeEvidenceSource[] }) {
  const [activeId, setActiveId] = useState(history.at(-1)?.id ?? "");
  useEffect(() => { setActiveId(history.at(-1)?.id ?? ""); }, [history.length]);
  if (!history.length) return <section className="knowledge-review-history"><div className="review-history-heading"><strong>评估记录</strong><span>尚无人工保存的评估</span></div></section>;
  const width = 400;
  const left = 28;
  const right = 390;
  const top = 12;
  const bottom = 92;
  const pointX = (index: number) => history.length === 1 ? (left + right) / 2 : left + index / (history.length - 1) * (right - left);
  const pointY = (score: number) => bottom - score / 100 * (bottom - top);
  const active = history.find((entry) => entry.id === activeId) ?? history.at(-1)!;
  const activeSources = active.evidenceSources ?? (active.evidenceSourceIds ?? [])
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is KnowledgeEvidenceSource => Boolean(source));
  return <section className="knowledge-review-history">
    <div className="review-history-heading"><strong>评估记录</strong><span>{history.length} 次已保存审核 · 最近 30 次</span></div>
    <svg className="review-history-chart" viewBox={`0 0 ${width} 118`} role="group" aria-label="人工含金量评分历史">
      {[0, 50, 100].map((value) => <g key={value}><line x1={left} y1={pointY(value)} x2={right} y2={pointY(value)} className="review-history-grid" /><text x="2" y={pointY(value) + 3} className="review-history-axis-label">{value}</text></g>)}
      <polyline points={history.map((entry, index) => `${pointX(index)},${pointY(entry.significanceScore)}`).join(" ")} className="review-history-line" />
      {history.map((entry, index) => <g key={entry.id} className={`review-history-point ${entry.id === active.id ? "active" : ""}`} role="button" tabIndex={0} aria-label={`${new Date(entry.updatedAt).toLocaleString("zh-CN")}，${entry.significanceScore} 分，${entry.source === "ai-assisted" ? "AI 建议经人工确认" : "人工填写"}`} aria-pressed={entry.id === active.id} onClick={() => setActiveId(entry.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveId(entry.id); } }}>
        <circle cx={pointX(index)} cy={pointY(entry.significanceScore)} r={entry.id === active.id ? 5 : 3.5} />
      </g>)}
      <text x={left} y="112" className="review-history-date">{new Date(history[0].updatedAt).toLocaleDateString("zh-CN")}</text>
      {history.length > 1 && <text x={right} y="112" textAnchor="end" className="review-history-date">{new Date(history.at(-1)!.updatedAt).toLocaleDateString("zh-CN")}</text>}
      <text x={pointX(history.findIndex((entry) => entry.id === active.id))} y={Math.max(9, pointY(active.significanceScore) - 8)} textAnchor="middle" className="review-history-score">{active.significanceScore}</text>
    </svg>
    <div className="review-history-detail"><div><strong>{active.significanceScore}<small>/ 100</small></strong><span>{new Date(active.updatedAt).toLocaleString("zh-CN")}</span><span>{active.verificationStatus === "已核验" ? "已核验" : "待核验"}</span><span>{active.source === "ai-assisted" ? "AI 建议经人工确认" : "人工填写"}</span></div><p>{active.scoreRationale || "未填写评估依据。"}</p>{activeSources.length > 0 && <div className="review-history-sources"><span>本次引用</span>{activeSources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}<ExternalLink size={10} /></strong><small>{[knowledgeEvidenceSourceTypeLabels[source.sourceType], source.dataYear, source.verified ? "当时已核对" : "当时待核对"].filter(Boolean).join(" · ")}</small>{source.note && <small>{source.note}</small>}</a>)}</div>}</div>
  </section>;
}

function KnowledgeBaseView({ onClose, initialId, resumes, records, onRecordsChange, onSelectEvidence, agentAvailable, webSearchAvailable }: { onClose: () => void; initialId?: string; resumes: Resume[]; records: KnowledgeRecord[]; onRecordsChange: (records: KnowledgeRecord[]) => void; onSelectEvidence: (id: string, evidence: string) => void; agentAvailable: boolean; webSearchAvailable: boolean }) {
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
  });
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
    setEnrichmentBusy(false); setEditingId(null); setDraft(emptyKnowledgeDraft); setEditorError(""); setEnrichmentHints(""); setEnrichmentProposal(null); setEditorOpen(true);
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
          <div><span className="eyebrow">RESEARCH LIBRARY</span><h2>竞赛、期刊与公司资料库</h2><p>查找背景资料、记录人工判断，并从简历分析报告双向跳转。</p></div>
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
              <textarea value={enrichmentHints} onChange={(event) => setEnrichmentHints(event.target.value)} maxLength={300} rows={2} placeholder="AI 整理重点（可选）：希望优先确认哪些背景信息？" />
              <button className="knowledge-enrich-button" onClick={enrichDraft} disabled={enrichmentBusy || !draft.title.trim()}>{enrichmentBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}{enrichmentBusy ? "正在整理资料" : webSearchAvailable ? "AI 整理资料草案 · 联网参考" : "AI 整理资料草案"}</button>
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
              <div className="knowledge-review"><div className="review-heading"><div><span className="eyebrow">HUMAN REVIEW</span><h4>人工含金量评估</h4></div><span>AI 建议需复核后保存</span></div>
                <label className="review-role">岗位背景<input value={roleContext} onChange={(event) => setRoleContext(event.target.value)} placeholder="例如：算法工程师、数据产品经理" /></label>
                <label className="review-focus">评估侧重（可选）<textarea value={reviewerFocus} onChange={(event) => setReviewerFocus(event.target.value)} maxLength={500} rows={2} placeholder="例如：优先看官方获奖名单与比赛规模，降低宣传性描述的权重" /><small>{reviewerFocus.length}/500</small></label>
                <button className="suggest-review" onClick={suggestReview} disabled={suggesting}>{suggesting ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{suggesting ? "正在查找并评估" : webSearchAvailable ? "AI 联网核验并建议" : "AI 建议含金量"}</button>
                {reviewProposal && <div className="review-proposal"><div><strong>AI 建议 {reviewProposal.score}</strong><span>当前草稿 {reviewScore} · 差值 {reviewProposal.score - reviewScore > 0 ? "+" : ""}{reviewProposal.score - reviewScore}</span></div><p>{reviewProposal.rationale}</p><div className="review-proposal-actions"><button onClick={() => { setReviewScore(reviewProposal.score); setReviewNote(reviewProposal.rationale); setReviewSource("ai-assisted"); setReviewSaved(false); setReviewProposal(null); }}>采用建议</button><button onClick={() => setReviewProposal(null)}>保留当前</button></div></div>}
                <label>核验状态<select value={verificationStatus} onChange={(event) => { setVerificationStatus(event.target.value as KnowledgeRecord["verificationStatus"]); setReviewSource("manual"); setReviewSaved(false); }}><option value="示例资料，待核验">待核验</option><option value="已核验">已核验</option></select></label>
                <label>评分 <output>{reviewScore}</output><input type="range" min="0" max="100" value={reviewScore} onChange={(event) => { setReviewScore(Number(event.target.value)); setReviewSource("manual"); setReviewSaved(false); }} /></label>
                <textarea value={reviewNote} onChange={(event) => { setReviewNote(event.target.value); setReviewSource("manual"); setReviewSaved(false); }} rows={4} placeholder="说明评分依据、岗位相关性和待核验事项" />
                {(selected.evidenceSources?.length ?? 0) > 0 && <fieldset className="review-evidence-citations"><legend>本次评分引用</legend>{selected.evidenceSources!.map((source) => <label key={source.id}><input type="checkbox" checked={reviewSourceIds.includes(source.id)} onChange={(event) => setReviewSourceIds((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} /><span>{source.title}<small>{knowledgeEvidenceSourceTypeLabels[source.sourceType]} · {source.verified ? "已人工核对" : "待核对"}</small></span></label>)}</fieldset>}
                {reviewSource === "ai-assisted" && <span className="review-source-note">当前草稿采用 AI 建议；点击保存后会记为经人工确认。</span>}
                {suggestionQuestions.length > 0 && <div className="verification-questions"><strong>建议核实</strong>{suggestionQuestions.map((item) => <span key={item}>{item}</span>)}</div>}
                {suggestionSearchStatus && <div className="research-result"><div className="research-result-head"><strong>{suggestionSearchStatus === "searched" ? `联网参考 · ${suggestionSources.length} 个来源` : suggestionSearchStatus === "no-results" ? "没有找到可用网页来源" : suggestionSearchStatus === "unavailable" ? "联网检索暂不可用" : "基于本地资料建议"}</strong>{suggestionConfidence !== null && <span>参考置信度 {Math.round(suggestionConfidence * 100)}%</span>}</div><p>{suggestionSearchStatus === "searched" ? "来源用于了解赛事、期刊或组织背景；不能证明候选人的具体获奖、发表或个人贡献。" : suggestionSearchStatus === "unavailable" ? "本次建议只参考本地资料字段，请通过官方来源人工核验。" : suggestionSearchStatus === "not-configured" ? "尚未配置网页搜索，本次建议仅依据本地资料字段。" : "本次建议仅依据本地资料字段，未引用外部来源。"}</p>{suggestionSources.map((source) => <a className="research-source" key={source.url} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}<ExternalLink size={12} /></strong><small>{source.url}</small>{source.snippet && <span>{source.snippet}</span>}</a>)}</div>}
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

function AnalysisDocument({ answer, busy, error, candidate, roleRequirements, scoreCard, knowledgeRecords, historyCandidates, onOpenKnowledge, onEvidence }: { answer: string; busy: boolean; error: string; candidate: Resume; roleRequirements: string; scoreCard: ScoreCard; knowledgeRecords: KnowledgeRecord[]; historyCandidates: HistoricalCandidate[]; onOpenKnowledge: (id?: string) => void; onEvidence: (evidence: string) => void }) {
  const pages = paginateReport(answer);
  return (
    <div className="analysis-document-shell">
      <div className="analysis-document-toolbar">
        <div className="document-tab"><FileText size={15} /><span>分析报告.pdf</span></div>
        <span className="analysis-document-meta">{answer ? `${pages.length} 页` : "待生成"}</span>
      </div>
      <div className="analysis-document-pages">
        {busy ? <div className="analysis-paper analysis-paper-state"><span className="working-mark"><Sparkles size={18} /></span><strong>正在生成分析文档</strong><p>Agent 正在整理简历证据、岗位匹配和建议追问。</p><div className="loading-line"><i /></div></div> : error ? <div className="analysis-paper analysis-paper-state error-paper"><strong>分析文档生成失败</strong><p>{error}</p></div> : answer ? pages.map((page, index) => <article className="analysis-paper" key={`${candidate.id}-${index}`}><div className="analysis-paper-head"><span>BOHACK / CANDIDATE REVIEW</span><span>{String(index + 1).padStart(2, "0")}</span></div><h3>{candidate.name} · 简历分析</h3><p className="analysis-paper-subtitle">{candidate.role} · {roleRequirements ? "已对照职位要求" : "职位要求待补充"}</p><div className="analysis-paper-body">{page}</div><div className="analysis-paper-foot">分析结果仅作招聘决策参考 · 第 {index + 1} 页 / {pages.length}</div></article>) : <div className="analysis-paper analysis-paper-state"><span className="empty-result-icon"><Sparkles size={18} /></span><strong>等待生成分析文档</strong><p>填写职位要求并开始分析，右侧会生成一份可滚动阅读的分析文档。</p><span className="evidence-note"><ShieldCheck size={13} /> 需要招聘人员复核</span></div>}
        <ScoreInsights card={scoreCard} candidate={candidate} records={knowledgeRecords} historyCandidates={historyCandidates} onOpenKnowledge={onOpenKnowledge} onEvidence={onEvidence} />
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

function demoScoreCard(resume: Resume, index: number, weights: ScoreWeights): ScoreCard {
  if (resume.scoreCard) return { ...resume.scoreCard, weights, composite: calculateComposite(resume.scoreCard.criteria, weights) };
  const values = [78 + index * 4, 84 - index * 3, 82 + index * 2, 72 + index * 5, 86 - index * 2, 76 + index * 3];
  const criteria = Object.fromEntries(scoreCriteria.map(({ key }, criterionIndex) => [key, { score: values[criterionIndex], evidence: ["示例资料中的工作成果与职责描述"], confidence: 0.72 }])) as ScoreCard["criteria"];
  return { criteria, weights, composite: calculateComposite(criteria, weights), overallConfidence: 0.72, formula: "weighted-mean-v1", evaluatedAt: new Date().toISOString() };
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

function ComparisonView({ resumes, weights, selectedId, onSelectResume, onEvidence, onClose, agentAvailable }: { resumes: Resume[]; weights: ScoreWeights; selectedId: string; onSelectResume: (id: string) => void; onEvidence: (evidence: string) => void; onClose: () => void; agentAvailable: boolean }) {
  const [rankCriterion, setRankCriterion] = useState<ComparisonRankCriterion>("composite");
  const [rankDirection, setRankDirection] = useState<ComparisonRankDraft["direction"]>("desc");
  const [ratingFilter, setRatingFilter] = useState<ComparisonRatingFilter>("all");
  const [rankInstruction, setRankInstruction] = useState("");
  const [rankProposal, setRankProposal] = useState<ComparisonRankDraft | null>(null);
  const [rankBusy, setRankBusy] = useState(false);
  const [rankError, setRankError] = useState("");
  const [focusEvidenceKey, setFocusEvidenceKey] = useState<ScoreKey | null>(null);
  const evidenceCardRefs = useRef(new Map<ScoreKey, HTMLElement>());
  const allRanked = useMemo(() => resumes.map((resume, index) => ({ resume, card: demoScoreCard(resume, index, weights) })).sort((left, right) => {
    const leftScore = rankCriterion === "composite" ? left.card.composite : left.card.criteria[rankCriterion].score;
    const rightScore = rankCriterion === "composite" ? right.card.composite : right.card.criteria[rankCriterion].score;
    const primary = rankDirection === "desc" ? rightScore - leftScore : leftScore - rightScore;
    return primary || right.card.composite - left.card.composite || left.resume.name.localeCompare(right.resume.name, "zh-CN");
  }), [resumes, weights, rankCriterion, rankDirection]);
  const ranked = useMemo(() => allRanked.filter(({ resume }) => ratingFilter === "all" || (ratingFilter === "scored" ? Boolean(resume.scoreCard) : !resume.scoreCard)), [allRanked, ratingFilter]);
  useEffect(() => {
    if (ranked.length && !ranked.some(({ resume }) => resume.id === selectedId)) onSelectResume(ranked[0].resume.id);
  }, [ranked, selectedId, onSelectResume]);
  const selected = ranked.find(({ resume }) => resume.id === selectedId) ?? ranked[0];
  useEffect(() => {
    if (!focusEvidenceKey || !selected) return;
    const target = evidenceCardRefs.current.get(focusEvidenceKey);
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    target?.focus({ preventScroll: true });
  }, [focusEvidenceKey, selected?.resume.id]);
  const rankLabels: Record<ComparisonRankCriterion, string> = { composite: "综合分", ...Object.fromEntries(scoreCriteria.map(({ key, label }) => [key, label])) } as Record<ComparisonRankCriterion, string>;
  const ratingFilterLabels: Record<ComparisonRatingFilter, string> = { all: "全部", scored: "已生成评分卡", demo: "演示 / 待评分" };

  async function suggestRanking() {
    setRankBusy(true); setRankError(""); setRankProposal(null);
    try {
      const response = await fetch("/api/resumes/comparison/rank-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: rankInstruction }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法生成排名方案。");
      setRankProposal(payload.suggestion as ComparisonRankDraft);
    } catch (error) { setRankError(error instanceof Error ? error.message : "无法生成排名方案。"); }
    finally { setRankBusy(false); }
  }

  return <main className="comparison-main comparison-workspace-main"><div className="comparison-panel">
    <div className="comparison-head"><div><span className="eyebrow">CANDIDATE COMPARISON</span><h2>多人候选人对比</h2></div><div className="comparison-head-actions"><span className="comparison-count">显示 {ranked.length} / {resumes.length} 位</span><button className="back-to-workspace" onClick={onClose}><span>返回分析</span></button></div></div>
    <p className="comparison-note">已生成评分卡 {resumes.filter((resume) => Boolean(resume.scoreCard)).length} 份 · 演示 / 待评分 {resumes.filter((resume) => !resume.scoreCard).length} 份。演示分不代表真实评估；选择评分来源可联动筛选质量图和排名表。</p>
    <div className="comparison-source-filter" role="group" aria-label="按评分来源筛选候选人"><span>评分来源</span>{(["all", "scored", "demo"] as ComparisonRatingFilter[]).map((filterKey) => { const count = filterKey === "all" ? resumes.length : resumes.filter((resume) => filterKey === "scored" ? Boolean(resume.scoreCard) : !resume.scoreCard).length; return <button key={filterKey} type="button" className={ratingFilter === filterKey ? "active" : ""} aria-pressed={ratingFilter === filterKey} onClick={() => setRatingFilter(filterKey)}>{ratingFilterLabels[filterKey]}<b>{count}</b></button>; })}</div>
    <section className="comparison-rank-tools" aria-label="设置候选人排名依据">
      <label>排名依据<select value={rankCriterion} onChange={(event) => setRankCriterion(event.target.value as ComparisonRankCriterion)}><option value="composite">综合分</option>{scoreCriteria.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>顺序<select value={rankDirection} onChange={(event) => setRankDirection(event.target.value as ComparisonRankDraft["direction"])}><option value="desc">高分优先</option><option value="asc">低分优先</option></select></label>
      <div className="comparison-rank-assistant"><input value={rankInstruction} onChange={(event) => { setRankInstruction(event.target.value); setRankProposal(null); setRankError(""); }} maxLength={500} placeholder="如：只看真实评分，按专业能力降序" aria-label="描述候选人筛选与排名要求" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void suggestRanking(); } }} /><button type="button" onClick={() => void suggestRanking()} disabled={!agentAvailable || rankBusy || !rankInstruction.trim()} title={agentAvailable ? "生成筛选与排名方案" : "请先配置模型服务"}>{rankBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}AI 排名</button>
      </div>
      {rankError && <span className="comparison-rank-error">{rankError}</span>}
      {rankProposal && <div className="comparison-rank-proposal"><span>{rankProposal.rationale}</span><strong>{ratingFilterLabels[rankProposal.ratingFilter]} · {rankLabels[rankProposal.criterion]} · {rankProposal.direction === "desc" ? "高分优先" : "低分优先"}</strong><div><button type="button" onClick={() => setRankProposal(null)}>放弃</button><button type="button" onClick={() => { setRankCriterion(rankProposal.criterion); setRankDirection(rankProposal.direction); setRatingFilter(rankProposal.ratingFilter); setRankProposal(null); }}>应用方案</button></div></div>}
    </section>
    {ranked.length ? <RecruitmentQualityMap candidates={ranked} selectedId={selected?.resume.id ?? ""} onSelect={onSelectResume} rankLabel={rankLabels[rankCriterion]} rankDirection={rankDirection} /> : <div className="comparison-empty">当前筛选下没有候选人。可切换评分来源查看其他档案。</div>}
    <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>排名</th><th>候选人</th>{scoreCriteria.map(({ key, label }) => <th key={key}>{label}</th>)}<th>综合分</th></tr></thead><tbody>{ranked.length ? ranked.map(({ resume, card }, rank) => <tr key={resume.id} className={resume.id === selected?.resume.id ? "selected" : ""} aria-selected={resume.id === selected?.resume.id}><td><span className={`rank-badge rank-${rank + 1}`}>{rank + 1}</span></td><td><button className="comparison-candidate-select" onClick={() => { onSelectResume(resume.id); setFocusEvidenceKey(null); }} aria-pressed={resume.id === selected?.resume.id}><strong>{resume.name}</strong><small>{resume.role} · {resume.scoreCard ? "已生成评分卡" : "演示 / 待评分"}</small></button></td>{scoreCriteria.map(({ key, label }) => { const criterion = card.criteria[key]; return <td className="score-cell" key={key}><button type="button" className="comparison-score-evidence" onClick={() => { onSelectResume(resume.id); setFocusEvidenceKey(key); }} title={`查看 ${resume.name} · ${label} 的评分依据`} aria-label={`${resume.name}，${label} ${criterion.score.toFixed(0)} 分，置信度 ${Math.round(criterion.confidence * 100)}%，查看评分依据`}><span className="score-cell-score"><span className="score-cell-value">{criterion.score.toFixed(0)}</span><i><b style={{ width: `${criterion.score}%` }} /></i></span><small className={`score-cell-confidence ${criterion.confidence < 0.45 ? "low-confidence" : ""}`}>置信度 {Math.round(criterion.confidence * 100)}%</small></button></td>; })}<td className="composite-cell">{card.composite.toFixed(1)}</td></tr>) : <tr><td colSpan={9} className="comparison-empty-cell">当前筛选下没有候选人。</td></tr>}</tbody></table></div>
    {selected && <section className="comparison-evidence"><div className="comparison-evidence-head"><div><span className="eyebrow">SELECTED CANDIDATE</span><h3>{selected.resume.name} · {selected.resume.role}</h3><p>{rankLabels[rankCriterion]}排名 {ranked.findIndex(({ resume }) => resume.id === selected.resume.id) + 1} · 综合分 {selected.card.composite.toFixed(1)} · 深度 {depthScore(selected.card).toFixed(1)} · 广度 {selected.card.criteria.perspective.score.toFixed(0)}</p></div><button className="back-to-workspace" onClick={() => { onSelectResume(selected.resume.id); onClose(); }}>打开简历分析</button></div><div className="comparison-evidence-grid">{scoreCriteria.map(({ key, label }) => { const criterion = selected.card.criteria[key]; return <article key={key} className={focusEvidenceKey === key ? "focused" : ""} ref={(element) => { if (element) evidenceCardRefs.current.set(key, element); else evidenceCardRefs.current.delete(key); }} tabIndex={-1}><div className="comparison-evidence-metric"><span><strong>{label}</strong><small className={criterion.confidence < 0.45 ? "low-confidence" : ""} title="模型对该维度现有简历证据充分度的估计；不是录用概率">置信度 {Math.round(criterion.confidence * 100)}%</small></span><b>{criterion.score.toFixed(0)}</b></div>{criterion.evidence.length ? criterion.evidence.slice(0, 2).map((evidence, index) => <button className="comparison-evidence-link" key={`${index}-${evidence}`} onClick={() => { onSelectResume(selected.resume.id); onEvidence(evidence); onClose(); }} title="回到 PDF 定位依据">{evidence}<ExternalLink size={10} /></button>) : <p>暂无可展示的证据摘要</p>}</article>; })}</div></section>}
    <div className="weight-summary"><span>当前权重</span>{scoreCriteria.map(({ key, label }) => <span key={key}>{label} {weights[key]}%</span>)}</div>
  </div></main>;
}

export default function App() {
  const [resumes, setResumes] = useState<Resume[]>(sampleResumes);
  const [selectedId, setSelectedId] = useState(sampleResumes[0].id);
  const [filter, setFilter] = useState("");
  const [roleRequirements, setRoleRequirements] = useState("");
  const [question, setQuestion] = useState("请根据职位要求分析这份简历，并给出有证据的匹配度评分。");
  const [webResearchEnabled, setWebResearchEnabled] = useState(false);
  const [researchSources, setResearchSources] = useState<KnowledgeSource[]>([]);
  const [researchStatus, setResearchStatus] = useState<"searched" | "not-configured" | "unavailable" | "not-requested" | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState("");
  const [evidenceLocation, setEvidenceLocation] = useState<{ query: string; page: number | null } | null>(null);
  const [answer, setAnswer] = useState("");
  const [agentError, setAgentError] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [importError, setImportError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCandidates, setHistoryCandidates] = useState<HistoricalCandidate[]>(historicalCandidates.map((candidate) => ({ ...candidate, source: "demo" })));
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
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const selected = resumes.find((resume) => resume.id === selectedId) ?? resumes[0];
  const filtered = useMemo(() => resumes.filter((resume) => `${resume.name} ${resume.role}`.toLowerCase().includes(filter.toLowerCase())), [resumes, filter]);
  const weightImpact = useMemo<WeightImpact | null>(() => {
    if (!weightProposal || !selected) return null;
    const comparableResumes = resumes.filter((resume) => roleGroup(resume.role) === roleGroup(selected.role));
    const rankFor = (nextWeights: ScoreWeights) => comparableResumes.map((resume) => ({ id: resume.id, score: demoScoreCard(resume, resumes.indexOf(resume), nextWeights).composite })).sort((a, b) => b.score - a.score);
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
    fetch("/api/resumes/knowledge").then((response) => response.json()).then((payload) => { if (Array.isArray(payload.records)) setKnowledgeRecords(payload.records); }).catch(() => undefined);
    fetch("/api/resumes/history").then((response) => response.json()).then((payload) => { if (Array.isArray(payload.candidates)) setHistoryCandidates(payload.candidates); }).catch(() => undefined);
  }, []);

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
    setResearchSources([]);
    setResearchStatus(null);
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
      setAgentError(latest.analysisStatus === "failed" ? latest.analysisError ?? "自动分析未完成，可手动重试。" : "");
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
    setBusy(true);
    setAgentError("");
    setAnswer("");
    try {
      const endpoint = selected.source === "pdf" ? `/api/resumes/${encodeURIComponent(selected.id)}/analyze` : "/api/agent";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeName: selected.name, resumeText: selected.text, roleRequirements, question, webResearchEnabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "分析请求失败。");
      setAnswer(payload.answer);
      setResearchSources(Array.isArray(payload.researchSources) ? payload.researchSources : []);
      setResearchStatus(payload.researchStatus ?? (selected.source === "pdf" ? "not-requested" : null));
      if (payload.resume) {
        setResumes((current) => current.map((resume) => resume.id === selected.id ? payload.resume as Resume : resume));
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "无法连接 Agent 服务。");
    } finally {
      setBusy(false);
    }
  }

  function openKnowledge(id?: string) {
    setKnowledgeTargetId(id);
    setKnowledgeOpen(true);
    setComparisonOpen(false);
    setHistoryOpen(false);
  }

  function selectResume(id: string) {
    const resume = resumes.find((item) => item.id === id);
    setSelectedId(id);
    setAnswer(resume?.analysisReport ?? "");
    setResearchSources([]);
    setResearchStatus(null);
    setEvidenceTarget("");
    setEvidenceLocation(null);
    setAgentError(resume?.analysisStatus === "failed" ? resume.analysisError ?? "自动分析未完成，可手动重试。" : "");
  }

  function selectResumeEvidence(id: string, evidence: string) {
    selectResume(id);
    setEvidenceTarget(evidence);
    setEvidenceLocation({ query: evidence, page: null });
  }

  const handleEvidenceResult = useCallback((result: { query: string; page: number | null }) => setEvidenceLocation(result), []);
  const locateEvidence = useCallback((evidence: string) => { setEvidenceTarget(evidence); setEvidenceLocation({ query: evidence, page: null }); }, []);

  if (!selected) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Bohack 简历工作台首页">
          <span className="brand-mark"><BriefcaseBusiness size={17} strokeWidth={2.2} /></span>
          <span>bohack<span className="brand-dot">.</span></span>
        </a>
        <div className="topbar-divider" />
        <div className="workspace-name">{knowledgeOpen ? "资料库" : comparisonOpen ? "候选人对比" : historyOpen ? "历史招聘样本" : "招聘工作台"} <ChevronDown size={14} /></div>
        <div className="topbar-spacer" />
        <div className="privacy-note"><ShieldCheck size={15} /> 本地存储</div>
        <button className="compare-button" onClick={() => { setComparisonOpen((current) => !current); setKnowledgeOpen(false); setHistoryOpen(false); }} title={comparisonOpen ? "返回单人分析" : "打开多人候选人对比"}>{comparisonOpen ? "返回分析" : <><BriefcaseBusiness size={14} />候选人对比</>}</button>
        <button className="compare-button" onClick={() => { if (knowledgeOpen) { setKnowledgeOpen(false); } else { openKnowledge(); } }} title={knowledgeOpen ? "返回简历分析" : "打开资料库"}>{knowledgeOpen ? "返回分析" : <><BookOpen size={14} />资料库</>}</button>
        <button className="compare-button" onClick={() => { setHistoryOpen((current) => !current); setKnowledgeOpen(false); setComparisonOpen(false); }} title={historyOpen ? "返回简历分析" : "管理历史招聘样本"}>{historyOpen ? "返回分析" : <><Database size={14} />历史样本</>}</button>
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
              <button className={`candidate-row ${resume.id === selected.id ? "selected" : ""}`} key={resume.id} onClick={() => selectResume(resume.id)}>
                <span className={`candidate-avatar avatar-${index % 4}`}>{resume.initials}</span>
                <span className="candidate-copy"><strong>{resume.name}</strong><span>{resume.role}</span></span>
                <span className="candidate-date">{resume.received}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="empty-list">没有匹配的简历</div>}
          </div>
          <div className="sidebar-footer"><span className="status-dot" /> 本地工作区 <span className="footer-count">{resumes.length} 份简历</span></div>
        </aside>

        {historyOpen ? <HistoricalDatabaseView candidates={historyCandidates} onCandidatesChange={setHistoryCandidates} onClose={() => setHistoryOpen(false)} agentAvailable={Boolean(health?.agent)} /> : knowledgeOpen ? <KnowledgeBaseView resumes={resumes} records={knowledgeRecords} onRecordsChange={setKnowledgeRecords} initialId={knowledgeTargetId} onSelectEvidence={selectResumeEvidence} onClose={() => setKnowledgeOpen(false)} agentAvailable={Boolean(health?.agent)} webSearchAvailable={Boolean(health?.webSearch)} /> : comparisonOpen ? <ComparisonView resumes={resumes} weights={weights} selectedId={selected.id} onSelectResume={selectResume} onEvidence={locateEvidence} onClose={() => setComparisonOpen(false)} agentAvailable={Boolean(health?.agent)} /> : <>
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
                {busy ? "分析中" : selected.analysisStatus === "failed" ? "重试分析" : "重新分析"}
              </button>
            </div>
          </div>

          <div className="document-toolbar">
            <div className="document-tab"><FileText size={15} /><span>{selected.source === "pdf" ? (selected.fileName ?? `${selected.name}.pdf`) : "简历预览"}</span></div>
            <div className="reader-controls"><span>{selected.source === "pdf" ? "本地 PDF" : "示例资料"}</span><span className="toolbar-separator" /><span>{selected.size ? `${Math.max(1, Math.round(selected.size / 1024))} KB` : "A4"}</span></div>
          </div>

          <section className="reader-area" aria-label="简历阅读区">
            {selected.source === "pdf" && pdfUrl ? (
              <PdfReader key={selected.id} url={pdfUrl} title={selected.fileName ?? `${selected.name}.pdf`} evidenceTarget={evidenceTarget} onEvidenceResult={handleEvidenceResult} />
            ) : (
              <div className="sample-page">
                <div className="sample-document-label"><span>BOHACK SAMPLE</span><span>简历资料 · 示例</span></div>
                <div className="sample-name-block"><div><h3>{selected.name}</h3><p>{selected.role} <span>·</span> {selected.location}</p></div><div className="sample-contact">人才档案<br />{selected.name.toLowerCase().replace(" ", ".")}@example.com</div></div>
                <div className="sample-summary">{renderEvidenceText(`${selected.text.split("。")[0]}。`, evidenceTarget)}</div>
                <div className="sample-section"><h4>工作经历</h4>{(selected.experiences ?? []).map((experience) => <article className="experience" key={experience.company}><div className="experience-heading"><div><strong>{experience.role}</strong><span>{experience.company}</span></div><time>{experience.period}</time></div><p>{renderEvidenceText(experience.detail, evidenceTarget)}</p></article>)}</div>
                <div className="sample-section"><h4>教育背景</h4><p className="sample-body">{renderEvidenceText(selected.education, evidenceTarget)}</p></div>
                <div className="sample-section"><h4>专业技能</h4><div className="skill-list">{selected.skills.map((skill) => <span key={skill}>{renderEvidenceText(skill, evidenceTarget)}</span>)}</div></div>
                <div className="sample-doc-footer">示例资料仅用于体验工作台。导入 PDF 后将在此处显示原始文件。</div>
              </div>
            )}
          </section>
        </main>

        <aside className="report-column">
          <div className="analysis-header"><div><span className="eyebrow">CANDIDATE REPORT</span><h2>分析文档</h2></div><span className={`report-status ${selected.analysisStatus === "complete" ? "complete" : selected.analysisStatus === "failed" ? "failed" : ""}`}>{selected.analysisStatus === "complete" ? "已生成" : selected.analysisStatus === "failed" ? "待重试" : answer ? "已生成" : "待生成"}</span></div>
          <div className="result-heading"><div><MessageSquareText size={16} /><h3>分析报告</h3></div>{answer && <button className="clear-result" onClick={() => setAnswer("")} title="清除分析文档" aria-label="清除分析文档"><X size={15} /></button>}</div>
          <AnalysisDocument answer={answer} busy={busy} error={agentError} candidate={selected} roleRequirements={roleRequirements} scoreCard={demoScoreCard(selected, Math.max(0, resumes.indexOf(selected)), weights)} knowledgeRecords={knowledgeRecords} historyCandidates={historyCandidates} onOpenKnowledge={openKnowledge} onEvidence={locateEvidence} />
          {evidenceLocation && <div className={`evidence-location ${evidenceLocation.page ? "found" : "missing"}`}><ShieldCheck size={12} /><span>{evidenceLocation.page ? `已在简历第 ${evidenceLocation.page} 页定位依据` : "这条依据尚未在 PDF 原文中精确定位"}</span><button onClick={() => { setEvidenceTarget(""); setEvidenceLocation(null); }} aria-label="关闭证据定位提示"><X size={12} /></button></div>}
          <div className="analysis-footer"><ShieldCheck size={14} /><span>分析仅作决策参考，需由招聘人员复核。</span></div>
        </aside>

        <aside className="analysis-column">
          <div className="analysis-header"><div><span className="eyebrow">BOHACK AGENT</span><h2>分析工作区</h2></div><span className={`agent-indicator ${health?.agent ? "ready" : ""}`} title={health?.agent ? "模型已连接" : "等待配置模型服务"}><span /></span></div>
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
          <label className="research-toggle"><span><Globe2 size={14} /><span>联网参考岗位背景</span><small>只搜索职位要求，不发送候选人简历</small></span><input className="switch-input" type="checkbox" checked={webResearchEnabled} onChange={(event) => setWebResearchEnabled(event.target.checked)} /><i className="switch-track"><b className="switch-thumb" /></i></label>
          <button className="run-agent-button" onClick={analyze} disabled={busy || !health?.agent || !question.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy ? "Agent 正在分析" : "开始分析"}
          </button>
          {researchStatus && researchStatus !== "not-requested" && <div className={`agent-research-summary ${researchStatus}`}><strong>{researchStatus === "searched" ? `岗位背景参考 · ${researchSources.length} 个来源` : researchStatus === "not-configured" ? "联网参考未配置" : "联网参考暂不可用"}</strong><span>{researchStatus === "searched" ? "来源只用于解释岗位背景，报告中的候选人结论仍需回到简历证据。" : "本次分析仍可继续，报告未将网络资料当作候选人证据。"}</span>{researchSources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={11} /></a>)}</div>}
          <div className="scoring-settings">
            <div className="scoring-settings-head"><div><span className="eyebrow">SCORING WEIGHTS</span><strong>评分权重</strong></div><span>{weightSaving ? "保存中" : `${Object.values(weights).reduce((sum, value) => sum + value, 0)}%`}</span></div>
            {scoreCriteria.map(({ key, label }) => <label className="weight-row" key={key}><span>{label}</span><input type="number" min="0" max="100" value={weights[key]} onChange={(event) => { setWeights({ ...weights, [key]: Number(event.target.value) } as ScoreWeights); setWeightProposal(null); setWeightError(""); }} onBlur={() => updateWeights(weights)} /><span>%</span></label>)}
            <div className="weight-agent"><input value={weightInstruction} onChange={(event) => { setWeightInstruction(event.target.value); setWeightProposal(null); setWeightError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); adjustWeightsWithAgent(); } }} placeholder="让 AI 调整，例如：更看重专业能力和岗位契合度" /><button title="生成权重调整方案" aria-label="生成权重调整方案" onClick={adjustWeightsWithAgent} disabled={weightBusy || weightSaving || !health?.agent}>{weightBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}</button></div>
            {weightError && <div className="inline-error">{weightError}</div>}
            {weightProposal && weightImpact && <WeightProposalPreview proposal={weightProposal} currentWeights={weights} impact={weightImpact} selectedHasScoreCard={Boolean(selected.scoreCard)} onDiscard={() => setWeightProposal(null)} onApply={() => updateWeights(weightProposal.weights)} busy={weightSaving} />}
          </div>
          {!health?.agent && <div className="setup-hint"><span className="setup-icon"><CircleHelp size={15} /></span><span>配置服务密钥后即可运行分析。<code>OPENAI_API_KEY</code>{health ? "" : " · 服务连接中"}</span></div>}

        </aside>
        </>}
      </div>
    </div>
  );
}
