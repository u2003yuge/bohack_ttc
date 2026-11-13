import { useEffect, useMemo, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { sampleResumes } from "./sample-resumes";
import type { Resume } from "./types";
import { calculateComposite, defaultScoreWeights, normalizeWeights, scoreCriteria, type ScoreCard, type ScoreKey, type ScoreWeights } from "../shared/scoring";
import { calculateBenchmark, roleGroup, roleGroupLabel } from "../shared/history";
import { knowledgeKindLabels, knowledgeRecords as seedKnowledgeRecords, type KnowledgeKind, type KnowledgeRecord, type KnowledgeReviewEntry } from "../shared/knowledge";

type AgentHealth = { agent: boolean; webSearch: boolean; model: string };
type KnowledgeSource = { title: string; url: string; snippet: string };
type WeightProposal = { weights: ScoreWeights; rationale: string };
type WeightImpact = { currentScore: number; proposedScore: number; currentRank: number; proposedRank: number; total: number; demoCount: number };

type ResumeListResponse = { resumes: Resume[]; directory: string };
type PdfTextLine = { id: string; page: number; text: string; x: number; y: number; width: number; height: number; angle: number };
const awardPattern = /(奖|获奖|award|acm|icpc|ccf|竞赛|比赛|金牌|银牌|铜牌|一等奖|二等奖|三等奖|优胜奖|冠军|亚军|季军|csp)/i;

function PdfReader({ url, title }: { url: string; title: string }) {
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

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
    setDocument(null);
    setPageNumber(1);
    setZoom(1);
    setTextLines([]);
    setAwardLines([]);
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
                {textLines.filter((line) => line.page === index + 1).map((line) => <span className={`pdf-text-item ${showAwardMask && awardPattern.test(line.text) ? "award-hit" : ""}`} key={line.id} style={{ left: line.x, top: line.y, width: line.width, height: line.height, fontSize: line.height, transform: `rotate(${line.angle}rad)` }}>{line.text}</span>)}
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

function findKnowledgeReferences(candidate: Resume, records: KnowledgeRecord[] = seedKnowledgeRecords): KnowledgeRecord[] {
  const text = `${candidate.name} ${candidate.role} ${candidate.text}`.toLowerCase();
  return records.filter((record) => [record.title, ...record.aliases].some((term) => term && text.includes(term.toLowerCase()))).slice(0, 6);
}

function KnowledgeReferenceBar({ candidate, records, onOpen }: { candidate: Resume; records: KnowledgeRecord[]; onOpen: (id?: string) => void }) {
  const references = findKnowledgeReferences(candidate, records);
  return <section className="knowledge-reference-bar"><div><span className="eyebrow">CROSS REFERENCES</span><strong>资料库交叉引用</strong><small>只根据简历原文中的名称或别名匹配</small></div><div className="knowledge-reference-list">{references.length ? references.map((record) => <button key={record.id} onClick={() => onOpen(record.id)}><span className={`knowledge-reference-dot ${record.kind}`} />{record.title}<b>{record.significanceScore}</b></button>) : <span className="knowledge-reference-empty">未识别资料</span>}<button className="knowledge-reference-search" onClick={() => onOpen()}>打开资料库 <ExternalLink size={12} /></button></div></section>;
}

function radarPoint(index: number, value: number, radius: number, center: number): string {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / scoreCriteria.length;
  return `${center + Math.cos(angle) * radius * value / 100},${center + Math.sin(angle) * radius * value / 100}`;
}

function ScoreRadar({ card }: { card: ScoreCard }) {
  const center = 96;
  const radius = 67;
  const outer = scoreCriteria.map((_, index) => radarPoint(index, 100, radius, center)).join(" ");
  const values = scoreCriteria.map(({ key }) => card.criteria[key].score);
  const area = values.map((value, index) => radarPoint(index, value, radius, center)).join(" ");
  return <div className="score-radar"><svg viewBox="0 0 192 192" role="img" aria-label="六项能力雷达图"><polygon points={outer} className="radar-grid" />{[25, 50, 75].map((level) => <polygon key={level} points={scoreCriteria.map((_, index) => radarPoint(index, level, radius, center)).join(" ")} className="radar-ring" />)}{scoreCriteria.map((_, index) => <line key={index} x1={center} y1={center} x2={radarPoint(index, 100, radius, center).split(",")[0]} y2={radarPoint(index, 100, radius, center).split(",")[1]} className="radar-axis" />)}<polygon points={area} className="radar-area" />{values.map((value, index) => { const [x, y] = radarPoint(index, value, radius, center).split(","); return <circle key={index} cx={x} cy={y} r="3" className="radar-dot" />; })}</svg><div className="radar-labels">{scoreCriteria.map(({ key, label }, index) => <span key={key} className={`radar-label radar-label-${index}`}>{label}<b>{card.criteria[key].score.toFixed(0)}</b></span>)}</div></div>;
}

function ScoreTrend({ card, candidate }: { card: ScoreCard; candidate: Resume }) {
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
        {focus && focusedCriterion && <div className="trend-evidence"><strong>{scoreCriteria.find((item) => item.key === focusedCriterion)?.label} · 评分依据</strong>{focus.evidence.length ? focus.evidence.map((item, index) => <span key={`${index}-${item}`}>{item}</span>) : <span>本次评估未提取到明确证据</span>}</div>}
        <small className="trend-weight-note">按该次评估保存的权重计算，旧记录不会随当前权重变化而重算。</small>
      </div>}
    </> : <div className="trend-empty"><strong>{candidate.source === "demo" ? "示例简历没有真实评估历史" : "尚无评分记录"}</strong><span>{candidate.source === "demo" ? "导入 PDF 并完成分析后，这里会显示实际评估结果。" : "导入初评会记录第一个分数；后续复评后形成真实趋势。"}</span></div>}
  </div>;
}

function ProjectBreakdownView({ candidate }: { candidate: Resume }) {
  const projects = deriveProjects(candidate);
  return <section className="project-breakdown"><div className="insight-section-head"><div><span className="eyebrow">PROJECT BREAKDOWN</span><h4>项目拆解 · 人话版</h4></div><span>{projects.length} 项</span></div>{projects.length ? projects.map((project) => <article className="project-item" key={project.title}><div className="project-title"><strong>{project.plainTitle}</strong><span>{project.title}</span></div><dl><div><dt>要解决什么</dt><dd>{project.goal}</dd></div><div><dt>具体做了什么</dt><dd>{project.actions}</dd></div><div><dt>带来什么结果</dt><dd>{project.outcome}</dd></div></dl></article>) : <p className="project-empty">当前简历没有足够的项目描述，建议在面试中追问目标、个人贡献和结果。</p>}</section>;
}

function BenchmarkBadge({ role, score }: { role: string; score: number }) {
  const [year, setYear] = useState<number | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const benchmark = calculateBenchmark(role, score, year);
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

function ScoreInsights({ card, candidate, records, onOpenKnowledge }: { card: ScoreCard; candidate: Resume; records: KnowledgeRecord[]; onOpenKnowledge: (id?: string) => void }) {
  return <div className="score-insights"><BenchmarkBadge role={candidate.role} score={card.composite} /><KnowledgeReferenceBar candidate={candidate} records={records} onOpen={onOpenKnowledge} /><section className="score-visuals"><div className="insight-section-head"><div><span className="eyebrow">CAPABILITY PROFILE</span><h4>能力画像</h4></div><span className="score-formula">综合分 {card.composite.toFixed(1)}</span></div><div className="score-visual-grid"><ScoreRadar card={card} /><ScoreTrend card={card} candidate={candidate} /></div></section><ProjectBreakdownView candidate={candidate} /></div>;
}

function depthScore(card: ScoreCard): number {
  const keys: ScoreKey[] = ["leadership", "expertise", "experience", "roleFit", "growth"];
  return Math.round(keys.reduce((total, key) => total + card.criteria[key].score, 0) / keys.length * 10) / 10;
}

function RecruitmentQualityMap({ candidates }: { candidates: Array<{ resume: Resume; card: ScoreCard }> }) {
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
  const maxComposite = Math.max(...candidates.map(({ card }) => card.composite), 1);
  return <section className="quality-map-section"><div className="quality-map-head"><div><span className="eyebrow">RECRUITING QUALITY MAP</span><h3>招聘质量图 · 深度 × 广度</h3><p>用一张图识别候选人的能力深度与经历广度。气泡越大，综合分越高。</p></div><div className="quality-map-legend"><span><i className="legend-dot legend-deep" />能力深度</span><span><i className="legend-dot legend-wide" />经历广度</span></div></div><div className="quality-map-wrap"><svg className="quality-map" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="候选人招聘质量深度广度散点图"><rect x={left} y={top} width={plotWidth} height={plotHeight} className="quality-map-bg" /><rect x={left} y={top} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-learning" /><rect x={left + plotWidth / 2} y={top} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-deep" /><rect x={left} y={top + plotHeight / 2} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-narrow" /><rect x={left + plotWidth / 2} y={top + plotHeight / 2} width={plotWidth / 2} height={plotHeight / 2} className="quality-quadrant quality-quadrant-broad" /><line x1={left + plotWidth / 2} y1={top} x2={left + plotWidth / 2} y2={top + plotHeight} className="quality-midline" /><line x1={left} y1={top + plotHeight / 2} x2={left + plotWidth} y2={top + plotHeight / 2} className="quality-midline" /><line x1={left} y1={top + plotHeight} x2={left + plotWidth} y2={top + plotHeight} className="quality-axis" /><line x1={left} y1={top} x2={left} y2={top + plotHeight} className="quality-axis" /><text x={left + plotWidth / 4} y={top + 18} className="quality-quadrant-label">待验证的成长型</text><text x={left + plotWidth * .75} y={top + 18} className="quality-quadrant-label">深度与广度兼具</text><text x={left + plotWidth / 4} y={top + plotHeight - 12} className="quality-quadrant-label">单一领域深耕</text><text x={left + plotWidth * .75} y={top + plotHeight - 12} className="quality-quadrant-label">广泛经历待聚焦</text>{[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={pointX(tick)} y1={top + plotHeight} x2={pointX(tick)} y2={top + plotHeight + 4} className="quality-axis" /><text x={pointX(tick)} y={height - 25} textAnchor="middle" className="quality-tick">{tick}</text><line x1={left - 4} y1={pointY(tick)} x2={left} y2={pointY(tick)} className="quality-axis" /><text x={left - 9} y={pointY(tick) + 3} textAnchor="end" className="quality-tick">{tick}</text></g>)}{candidates.map(({ resume, card }, index) => { const breadth = card.criteria.perspective.score; const depth = depthScore(card); const radius = 8 + (card.composite / maxComposite) * 7; const x = pointX(breadth); const y = pointY(depth); return <g key={resume.id} className="quality-point"><title>{`${resume.name}：深度 ${depth.toFixed(0)}，广度 ${breadth.toFixed(0)}，综合分 ${card.composite.toFixed(1)}`}</title><circle cx={x} cy={y} r={radius} className={`quality-bubble quality-bubble-${Math.min(index + 1, 4)}`} /><text x={x} y={y - radius - 5} textAnchor="middle" className="quality-name">{resume.name.length > 9 ? `${resume.name.slice(0, 9)}…` : resume.name}</text></g>; })}<text x={left + plotWidth / 2} y={height - 7} textAnchor="middle" className="quality-axis-label">经历广度（行业、领域、方法和团队经历）</text><text x="14" y={top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 14 ${top + plotHeight / 2})`} className="quality-axis-label">能力深度</text></svg></div><div className="quality-map-note"><span>深度 = 领导力、专业能力、经验、岗位契合度和进步分的平均值</span><span>广度 = 经历广度分</span></div></section>;
}

type KnowledgeDraft = { title: string; kind: KnowledgeKind; aliases: string; field: string; organizer: string; region: string; summary: string; signals: string; officialUrl: string };
type KnowledgeSort = "default" | "score" | "updated" | "title";
const emptyKnowledgeDraft: KnowledgeDraft = { title: "", kind: "competition", aliases: "", field: "", organizer: "", region: "", summary: "", signals: "", officialUrl: "" };

function KnowledgeReviewHistory({ history }: { history: KnowledgeReviewEntry[] }) {
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
    <div className="review-history-detail"><div><strong>{active.significanceScore}<small>/ 100</small></strong><span>{new Date(active.updatedAt).toLocaleString("zh-CN")}</span><span>{active.verificationStatus === "已核验" ? "已核验" : "待核验"}</span><span>{active.source === "ai-assisted" ? "AI 建议经人工确认" : "人工填写"}</span></div><p>{active.scoreRationale || "未填写评估依据。"}</p></div>
  </section>;
}

function KnowledgeBaseView({ onClose, initialId, resumes, records, onRecordsChange, onSelectResume, webSearchAvailable }: { onClose: () => void; initialId?: string; resumes: Resume[]; records: KnowledgeRecord[]; onRecordsChange: (records: KnowledgeRecord[]) => void; onSelectResume: (id: string) => void; webSearchAvailable: boolean }) {
  const [kind, setKind] = useState<KnowledgeKind | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<KnowledgeSort>("default");
  const [selectedId, setSelectedId] = useState(seedKnowledgeRecords[0].id);
  const [reviewScore, setReviewScore] = useState(seedKnowledgeRecords[0].significanceScore);
  const [reviewNote, setReviewNote] = useState(seedKnowledgeRecords[0].scoreRationale);
  const [reviewSource, setReviewSource] = useState<"manual" | "ai-assisted">("manual");
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
  const [draft, setDraft] = useState<KnowledgeDraft>(emptyKnowledgeDraft);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = records.filter((record) => (kind === "all" || record.kind === kind) && `${record.title} ${record.aliases.join(" ")} ${record.field} ${record.organizer} ${record.summary} ${record.signals.join(" ")}`.toLocaleLowerCase().includes(normalizedQuery));
  const sortedRecords = [...filtered].sort((a, b) => sort === "score" ? b.significanceScore - a.significanceScore : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : 0);
  const selected = sortedRecords.find((record) => record.id === selectedId) ?? sortedRecords[0] ?? null;
  const kindSummary = (Object.keys(knowledgeKindLabels) as KnowledgeKind[]).map((value) => {
    const items = records.filter((record) => record.kind === value);
    const reviewed = items.filter((record) => record.verificationStatus === "已核验");
    const average = reviewed.length ? Math.round(reviewed.reduce((sum, record) => sum + record.significanceScore, 0) / reviewed.length) : null;
    return { kind: value, count: items.length, reviewed: reviewed.length, average };
  });

  useEffect(() => {
    if (initialId && records.some((record) => record.id === initialId)) {
      setKind("all"); setQuery(""); setSelectedId(initialId);
    }
  }, [initialId, records]);
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id); setReviewScore(selected.significanceScore); setReviewNote(selected.scoreRationale); setVerificationStatus(selected.verificationStatus); setReviewSource("manual"); setReviewError(""); setReviewSaved(false);
    setSuggestionQuestions([]); setSuggestionSources([]); setSuggestionConfidence(null); setSuggestionSearchStatus(null);
  }, [selected?.id]);

  function beginCreate() {
    setEditingId(null); setDraft(emptyKnowledgeDraft); setEditorError(""); setEditorOpen(true);
  }

  function beginEdit() {
    if (!selected) return;
    setEditingId(selected.id);
    setDraft({ ...selected, aliases: selected.aliases.join("\n"), signals: selected.signals.join("\n") });
    setEditorError(""); setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false); setEditingId(null); setDraft(emptyKnowledgeDraft); setEditorError("");
  }

  async function saveRecord() {
    if (!draft.title.trim()) return;
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

  async function saveReview() {
    if (!selected) return;
    setSaving(true); setReviewError(""); setReviewSaved(false);
    try {
      const response = await fetch(`/api/resumes/knowledge/${encodeURIComponent(selected.id)}/review`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ significanceScore: reviewScore, scoreRationale: reviewNote, verificationStatus, source: reviewSource }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法保存人工评估。");
      if (payload.record) { onRecordsChange(records.map((record) => record.id === selected.id ? payload.record : record)); setReviewSaved(true); }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "无法保存人工评估。");
    } finally { setSaving(false); }
  }

  async function suggestReview() {
    if (!selected) return;
    setSuggesting(true); setReviewError(""); setReviewSaved(false); setSuggestionQuestions([]); setSuggestionSources([]); setSuggestionConfidence(null); setSuggestionSearchStatus(null);
    try {
      const response = await fetch(`/api/resumes/knowledge/${encodeURIComponent(selected.id)}/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleContext, reviewerFocus }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 建议暂时不可用。");
      setReviewScore(payload.suggestion.score); setReviewNote(payload.suggestion.rationale); setSuggestionQuestions(payload.suggestion.verificationQuestions ?? []);
      setReviewSource("ai-assisted");
      setSuggestionSources(Array.isArray(payload.sources) ? payload.sources : []); setSuggestionConfidence(payload.suggestion.confidence ?? null); setSuggestionSearchStatus(payload.searchStatus ?? "not-configured");
    } catch (error) { setReviewError(error instanceof Error ? error.message : "AI 建议暂时不可用。"); }
    finally { setSuggesting(false); }
  }

  const referencedResumes = selected ? resumes.filter((resume) => findKnowledgeReferences(resume, records).some((record) => record.id === selected.id)) : [];
  return (
    <main className="knowledge-main">
      <div className="knowledge-shell">
        <div className="knowledge-header"><div><span className="eyebrow">RESEARCH LIBRARY</span><h2>竞赛、期刊与公司资料库</h2><p>查找背景资料、记录人工判断，并从简历分析报告双向跳转。</p></div><button className="back-to-workspace" onClick={onClose}>返回简历分析</button></div>
        <section className="knowledge-overview" aria-label="资料库分类概览">
          <div className="knowledge-overview-heading"><div><strong>资料分布</strong><span>点击分类可筛选条目</span></div><small>已核验 {records.filter((record) => record.verificationStatus === "已核验").length} / {records.length}</small></div>
          <div className="knowledge-overview-grid">{kindSummary.map((item) => <button key={item.kind} className={`knowledge-overview-item ${kind === item.kind ? "active" : ""}`} onClick={() => setKind(kind === item.kind ? "all" : item.kind)} aria-pressed={kind === item.kind}>
            <span className="knowledge-overview-top"><strong>{knowledgeKindLabels[item.kind]}</strong><b>{item.count}</b></span>
            <span className="knowledge-overview-track" role="img" aria-label={`${knowledgeKindLabels[item.kind]}占资料库 ${records.length ? Math.round(item.count / records.length * 100) : 0}%`}><i style={{ width: `${records.length ? item.count / records.length * 100 : 0}%` }} /></span>
            <span className="knowledge-overview-bottom"><span>{item.reviewed} 条已核验</span><span>{item.average === null ? "均分待积累" : `核验均分 ${item.average}`}</span></span>
          </button>)}</div>
        </section>
        <div className="knowledge-body">
          <aside className="knowledge-list">
            <label className="search-box knowledge-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、别名、领域或内容" /></label>
            <button className="add-knowledge-button" onClick={editorOpen ? closeEditor : beginCreate}>{editorOpen ? <X size={13} /> : <Plus size={13} />}{editorOpen ? "关闭编辑" : "新增资料"}</button>
            {editorOpen && <div className="knowledge-create-form">
              <strong>{editingId ? "编辑资料" : "新增资料"}</strong>
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="资料名称 *" />
              <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as KnowledgeKind })}>{(Object.keys(knowledgeKindLabels) as KnowledgeKind[]).map((key) => <option value={key} key={key}>{knowledgeKindLabels[key]}</option>)}</select>
              <textarea value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} rows={2} placeholder="别名，每行一项" />
              <input value={draft.field} onChange={(event) => setDraft({ ...draft, field: event.target.value })} placeholder="所属领域" />
              <input value={draft.organizer} onChange={(event) => setDraft({ ...draft, organizer: event.target.value })} placeholder="主办方 / 组织" />
              <input value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} placeholder="地区" />
              <textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} rows={3} placeholder="简介与信息边界" />
              <textarea value={draft.signals} onChange={(event) => setDraft({ ...draft, signals: event.target.value })} rows={2} placeholder="人工审核信号，每行一项" />
              <input value={draft.officialUrl} onChange={(event) => setDraft({ ...draft, officialUrl: event.target.value })} placeholder="官方来源网址（可选）" />
              {editorError && <div className="inline-error">{editorError}</div>}
              <button onClick={saveRecord} disabled={editorBusy || !draft.title.trim()}>{editorBusy ? "保存中" : editingId ? "保存修改" : "创建资料"}</button>
            </div>}
            <div className="knowledge-filters"><div className="knowledge-filter-buttons"><button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>全部</button>{(Object.keys(knowledgeKindLabels) as KnowledgeKind[]).map((key) => <button className={kind === key ? "active" : ""} key={key} onClick={() => setKind(key)}>{knowledgeKindLabels[key]}</button>)}</div><label className="knowledge-sort-label"><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as KnowledgeSort)} aria-label="资料排序"><option value="default">默认</option><option value="updated">最近更新</option><option value="score">评分高低</option><option value="title">名称</option></select></label></div>
            <div className="knowledge-result-count">显示 {sortedRecords.length} / {records.length} 条</div>
            <div className="knowledge-record-list">{sortedRecords.map((record) => <button className={`knowledge-record-row ${record.id === selected?.id ? "selected" : ""}`} key={record.id} onClick={() => setSelectedId(record.id)}><span className={`knowledge-kind-icon ${record.kind}`}><BookOpen size={15} /></span><span><strong>{record.title}</strong><small>{record.field || "未分类"} · {record.region || "地区待补充"} · {record.verificationStatus === "已核验" ? "已核验" : "待核验"}</small></span><b>{record.significanceScore}</b></button>)}{!sortedRecords.length && <div className="empty-list">没有匹配资料</div>}</div>
          </aside>
          <section className="knowledge-detail">
            {selected ? <>
              <div className="knowledge-detail-head"><div><span className={`knowledge-type ${selected.kind}`}>{knowledgeKindLabels[selected.kind]}</span><h3>{selected.title}</h3><p>{selected.aliases.join(" · ") || "暂无别名"}</p></div><div className="knowledge-detail-controls"><strong className="knowledge-score">{selected.significanceScore}<small>/ 100</small></strong><button className="icon-button" onClick={beginEdit} title="编辑资料" aria-label="编辑资料"><Pencil size={15} /></button></div></div>
              <div className="knowledge-meta"><span><b>领域</b>{selected.field || "未填写"}</span><span><b>组织 / 主办方</b>{selected.organizer || "未填写"}</span><span><b>地区</b>{selected.region || "未填写"}</span><span><b>核验状态</b>{selected.verificationStatus}</span></div>
              <p className="knowledge-summary">{selected.summary || "尚无简介，请编辑资料补充背景和信息边界。"}</p>
              <div className="knowledge-signals"><strong>审核信号</strong><div>{selected.signals.length ? selected.signals.map((signal) => <span key={signal}>{signal}</span>) : <small>尚未添加审核信号</small>}</div></div>
              <div className="knowledge-referenced-resumes"><strong>被这些简历引用</strong>{referencedResumes.length ? referencedResumes.map((resume) => <button key={resume.id} onClick={() => { onSelectResume(resume.id); onClose(); }}><span className="candidate-avatar">{resume.initials}</span>{resume.name} · {resume.role}</button>) : <span>当前简历中没有匹配的名称或别名</span>}</div>
              <div className="knowledge-review"><div className="review-heading"><div><span className="eyebrow">HUMAN REVIEW</span><h4>人工含金量评估</h4></div><span>AI 建议需复核后保存</span></div>
                <label className="review-role">岗位背景<input value={roleContext} onChange={(event) => setRoleContext(event.target.value)} placeholder="例如：算法工程师、数据产品经理" /></label>
                <label className="review-focus">评估侧重（可选）<textarea value={reviewerFocus} onChange={(event) => setReviewerFocus(event.target.value)} maxLength={500} rows={2} placeholder="例如：优先看官方获奖名单与比赛规模，降低宣传性描述的权重" /><small>{reviewerFocus.length}/500</small></label>
                <button className="suggest-review" onClick={suggestReview} disabled={suggesting}>{suggesting ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{suggesting ? "正在查找并评估" : webSearchAvailable ? "AI 联网核验并建议" : "AI 建议含金量"}</button>
                <label>核验状态<select value={verificationStatus} onChange={(event) => { setVerificationStatus(event.target.value as KnowledgeRecord["verificationStatus"]); setReviewSource("manual"); setReviewSaved(false); }}><option value="示例资料，待核验">待核验</option><option value="已核验">已核验</option></select></label>
                <label>评分 <output>{reviewScore}</output><input type="range" min="0" max="100" value={reviewScore} onChange={(event) => { setReviewScore(Number(event.target.value)); setReviewSource("manual"); setReviewSaved(false); }} /></label>
                <textarea value={reviewNote} onChange={(event) => { setReviewNote(event.target.value); setReviewSource("manual"); setReviewSaved(false); }} rows={4} placeholder="说明评分依据、岗位相关性和待核验事项" />
                {suggestionQuestions.length > 0 && <div className="verification-questions"><strong>建议核实</strong>{suggestionQuestions.map((item) => <span key={item}>{item}</span>)}</div>}
                {suggestionSearchStatus && <div className="research-result"><div className="research-result-head"><strong>{suggestionSearchStatus === "searched" ? `联网参考 · ${suggestionSources.length} 个来源` : suggestionSearchStatus === "no-results" ? "没有找到可用网页来源" : suggestionSearchStatus === "unavailable" ? "联网检索暂不可用" : "基于本地资料建议"}</strong>{suggestionConfidence !== null && <span>参考置信度 {Math.round(suggestionConfidence * 100)}%</span>}</div><p>{suggestionSearchStatus === "searched" ? "来源用于了解赛事、期刊或组织背景；不能证明候选人的具体获奖、发表或个人贡献。" : suggestionSearchStatus === "unavailable" ? "本次建议只参考本地资料字段，请通过官方来源人工核验。" : suggestionSearchStatus === "not-configured" ? "尚未配置网页搜索，本次建议仅依据本地资料字段。" : "本次建议仅依据本地资料字段，未引用外部来源。"}</p>{suggestionSources.map((source) => <a className="research-source" key={source.url} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}<ExternalLink size={12} /></strong><small>{source.url}</small>{source.snippet && <span>{source.snippet}</span>}</a>)}</div>}
                {reviewError && <div className="inline-error">{reviewError}</div>}{reviewSaved && <div className="review-saved">人工评估已保存</div>}
                <button className="save-review" onClick={saveReview} disabled={saving}>{saving ? "保存中" : "保存人工评估"}</button>
              </div>
              <KnowledgeReviewHistory key={selected.id} history={selected.reviewHistory ?? []} />
              {selected.officialUrl && <a className="official-link" href={selected.officialUrl} target="_blank" rel="noreferrer">打开官方来源 <ExternalLink size={14} /></a>}
            </> : <div className="knowledge-empty-detail">没有符合筛选条件的资料。</div>}
          </section>
        </div>
      </div>
    </main>
  );
}

function AnalysisDocument({ answer, busy, error, candidate, roleRequirements, scoreCard, knowledgeRecords, onOpenKnowledge }: { answer: string; busy: boolean; error: string; candidate: Resume; roleRequirements: string; scoreCard: ScoreCard; knowledgeRecords: KnowledgeRecord[]; onOpenKnowledge: (id?: string) => void }) {
  const pages = paginateReport(answer);
  return (
    <div className="analysis-document-shell">
      <div className="analysis-document-toolbar">
        <div className="document-tab"><FileText size={15} /><span>分析报告.pdf</span></div>
        <span className="analysis-document-meta">{answer ? `${pages.length} 页` : "待生成"}</span>
      </div>
      <div className="analysis-document-pages">
        {busy ? <div className="analysis-paper analysis-paper-state"><span className="working-mark"><Sparkles size={18} /></span><strong>正在生成分析文档</strong><p>Agent 正在整理简历证据、岗位匹配和建议追问。</p><div className="loading-line"><i /></div></div> : error ? <div className="analysis-paper analysis-paper-state error-paper"><strong>分析文档生成失败</strong><p>{error}</p></div> : answer ? pages.map((page, index) => <article className="analysis-paper" key={`${candidate.id}-${index}`}><div className="analysis-paper-head"><span>BOHACK / CANDIDATE REVIEW</span><span>{String(index + 1).padStart(2, "0")}</span></div><h3>{candidate.name} · 简历分析</h3><p className="analysis-paper-subtitle">{candidate.role} · {roleRequirements ? "已对照职位要求" : "职位要求待补充"}</p><div className="analysis-paper-body">{page}</div><div className="analysis-paper-foot">分析结果仅作招聘决策参考 · 第 {index + 1} 页 / {pages.length}</div></article>) : <div className="analysis-paper analysis-paper-state"><span className="empty-result-icon"><Sparkles size={18} /></span><strong>等待生成分析文档</strong><p>填写职位要求并开始分析，右侧会生成一份可滚动阅读的分析文档。</p><span className="evidence-note"><ShieldCheck size={13} /> 需要招聘人员复核</span></div>}
        <ScoreInsights card={scoreCard} candidate={candidate} records={knowledgeRecords} onOpenKnowledge={onOpenKnowledge} />
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

function ComparisonView({ resumes, weights, onClose }: { resumes: Resume[]; weights: ScoreWeights; onClose: () => void }) {
  const ranked = resumes.map((resume, index) => ({ resume, card: demoScoreCard(resume, index, weights) })).sort((a, b) => b.card.composite - a.card.composite);
  return <main className="comparison-main comparison-workspace-main"><div className="comparison-panel"><div className="comparison-head"><div><span className="eyebrow">CANDIDATE COMPARISON</span><h2>多人候选人对比</h2></div><div className="comparison-head-actions"><span className="comparison-count">{ranked.length} 位候选人</span><button className="back-to-workspace" onClick={onClose}><span>返回分析</span></button></div></div><p className="comparison-note">按当前权重计算综合分，分数仅使用简历中与工作相关的证据。</p><RecruitmentQualityMap candidates={ranked} /><div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>排名</th><th>候选人</th>{scoreCriteria.map(({ key, label }) => <th key={key}>{label}</th>)}<th>综合分</th></tr></thead><tbody>{ranked.map(({ resume, card }, rank) => <tr key={resume.id}><td><span className={`rank-badge rank-${rank + 1}`}>{rank + 1}</span></td><td><strong>{resume.name}</strong><small>{resume.role}</small></td>{scoreCriteria.map(({ key }) => <td key={key}>{card.criteria[key].score.toFixed(0)}</td>)}<td className="composite-cell">{card.composite.toFixed(1)}</td></tr>)}</tbody></table></div><div className="weight-summary"><span>当前权重</span>{scoreCriteria.map(({ key, label }) => <span key={key}>{label} {weights[key]}%</span>)}</div></div></main>;
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
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [importError, setImportError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeTargetId, setKnowledgeTargetId] = useState<string | undefined>();
  const [knowledgeRecords, setKnowledgeRecords] = useState<KnowledgeRecord[]>(seedKnowledgeRecords);
  const [weights, setWeights] = useState<ScoreWeights>(defaultScoreWeights);
  const [weightInstruction, setWeightInstruction] = useState("");
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightProposal, setWeightProposal] = useState<WeightProposal | null>(null);
  const [weightError, setWeightError] = useState("");
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
        body: JSON.stringify({ resumeName: selected.name, resumeText: selected.text, roleRequirements, question }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "分析请求失败。");
      setAnswer(payload.answer);
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
  }

  function selectResume(id: string) {
    const resume = resumes.find((item) => item.id === id);
    setSelectedId(id);
    setAnswer(resume?.analysisReport ?? "");
    setAgentError(resume?.analysisStatus === "failed" ? resume.analysisError ?? "自动分析未完成，可手动重试。" : "");
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
        <div className="workspace-name">{knowledgeOpen ? "资料库" : comparisonOpen ? "候选人对比" : "招聘工作台"} <ChevronDown size={14} /></div>
        <div className="topbar-spacer" />
        <div className="privacy-note"><ShieldCheck size={15} /> 本地存储</div>
        <button className="compare-button" onClick={() => { setComparisonOpen((current) => !current); setKnowledgeOpen(false); }} title={comparisonOpen ? "返回单人分析" : "打开多人候选人对比"}>{comparisonOpen ? "返回分析" : <><BriefcaseBusiness size={14} />候选人对比</>}</button>
        <button className="compare-button" onClick={() => { if (knowledgeOpen) { setKnowledgeOpen(false); } else { openKnowledge(); } }} title={knowledgeOpen ? "返回简历分析" : "打开资料库"}>{knowledgeOpen ? "返回分析" : <><BookOpen size={14} />资料库</>}</button>
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

        {knowledgeOpen ? <KnowledgeBaseView resumes={resumes} records={knowledgeRecords} onRecordsChange={setKnowledgeRecords} initialId={knowledgeTargetId} onSelectResume={selectResume} onClose={() => setKnowledgeOpen(false)} webSearchAvailable={Boolean(health?.webSearch)} /> : comparisonOpen ? <ComparisonView resumes={resumes} weights={weights} onClose={() => setComparisonOpen(false)} /> : <>
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

        <aside className="report-column">
          <div className="analysis-header"><div><span className="eyebrow">CANDIDATE REPORT</span><h2>分析文档</h2></div><span className={`report-status ${selected.analysisStatus === "complete" ? "complete" : selected.analysisStatus === "failed" ? "failed" : ""}`}>{selected.analysisStatus === "complete" ? "已生成" : selected.analysisStatus === "failed" ? "待重试" : answer ? "已生成" : "待生成"}</span></div>
          <div className="result-heading"><div><MessageSquareText size={16} /><h3>分析报告</h3></div>{answer && <button className="clear-result" onClick={() => setAnswer("")} title="清除分析文档" aria-label="清除分析文档"><X size={15} /></button>}</div>
          <AnalysisDocument answer={answer} busy={busy} error={agentError} candidate={selected} roleRequirements={roleRequirements} scoreCard={demoScoreCard(selected, Math.max(0, resumes.indexOf(selected)), weights)} knowledgeRecords={knowledgeRecords} onOpenKnowledge={openKnowledge} />
          <div className="analysis-footer"><ShieldCheck size={14} /><span>分析仅作决策参考，需由招聘人员复核。</span></div>
        </aside>

        <aside className="analysis-column">
          <div className="analysis-header"><div><span className="eyebrow">BOHACK AGENT</span><h2>分析工作区</h2></div><span className={`agent-indicator ${health?.agent ? "ready" : ""}`} title={health?.agent ? "模型已连接" : "等待配置模型服务"}><span /></span></div>
          <div className="agent-capabilities"><div><Sparkles size={14} /><span>简历分析 Skill</span><Check size={14} className="capability-check" /></div><div><Globe2 size={14} /><span>网页搜索</span><span className={`capability-state ${health?.webSearch ? "available" : "unavailable"}`}>{health?.webSearch ? "已连接" : "待配置"}</span></div></div>
          <label className="field-label" htmlFor="role-requirements">职位要求 <span>可选</span></label>
          <textarea id="role-requirements" className="role-input" value={roleRequirements} onChange={(event) => setRoleRequirements(event.target.value)} placeholder="粘贴职位描述或关键要求，例如：5 年以上 B2B 产品经验，熟悉数据分析与团队协作……" rows={5} />
          <label className="field-label question-label" htmlFor="agent-question">分析任务</label>
          <textarea id="agent-question" className="question-input" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} />
          <button className="run-agent-button" onClick={analyze} disabled={busy || !health?.agent || !question.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy ? "Agent 正在分析" : "开始分析"}
          </button>
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
