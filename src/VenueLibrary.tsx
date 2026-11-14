import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, Search, X } from "lucide-react";
import { findKnowledgeMatch, type KnowledgeRecord } from "../shared/knowledge";
import { venueSearchText } from "../shared/venues";
import { venueLogoAsset } from "../shared/venue-assets";
import type { VenueProfile } from "../shared/venue-profile";
import type { Resume } from "./types";
import MaterialScoreLibrary, { MaterialScoreSummary } from "./MaterialScoreLibrary";
import "./venue-library.css";

type Props = {
  records: KnowledgeRecord[];
  resumes: Resume[];
  initialId?: string;
  query: string;
  type: string;
  system: string;
  rank: string;
  onQueryChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onSystemChange: (value: string) => void;
  onRankChange: (value: string) => void;
  onReview: (id: string) => void;
  onSelectEvidence: (resumeId: string, evidence: string) => void;
};

type ToolbarProps = Pick<Props, "records" | "query" | "type" | "system" | "rank" | "onQueryChange" | "onTypeChange" | "onSystemChange" | "onRankChange">;

export function VenueLibraryToolbar({ records, query, onQueryChange, type, onTypeChange, system, onSystemChange, rank, onRankChange }: ToolbarProps) {
  const systems = [...new Set(records.flatMap((record) => record.venue?.rankings.map((item) => JSON.stringify([item.system, item.edition, item.year])) ?? []))];
  const ranks = [...new Set(records.flatMap((record) => record.venue?.rankings.filter((item) => !system || JSON.stringify([item.system, item.edition, item.year]) === system).map((item) => item.rank) ?? []))].sort();
  const hasFilters = Boolean(query || type || system || rank);
  const clearFilters = () => { onQueryChange(""); onTypeChange(""); onSystemChange(""); onRankChange(""); };
  return <div className="venue-section-tools" aria-label="筛选期刊会议">
    {hasFilters && <button type="button" className="venue-clear-filters" onClick={clearFilters}>清除筛选</button>}
    <select aria-label="期刊会议类型" value={type} onChange={(event) => onTypeChange(event.target.value)}><option value="">全部类型</option><option>会议</option><option>期刊</option></select>
    <select aria-label="分级体系与版本" value={system} onChange={(event) => onSystemChange(event.target.value)}><option value="">全部分级版本</option>{systems.map((key) => { const [name, edition] = JSON.parse(key); return <option value={key} key={key}>{name} · {edition}</option>; })}<option value="unlisted">未登记分级</option></select>
    <select aria-label="目录等级" value={rank} disabled={system === "unlisted"} onChange={(event) => onRankChange(event.target.value)}><option value="">全部等级</option>{ranks.map((value) => <option key={value}>{value}</option>)}</select>
    <label className="venue-section-search"><Search size={15} /><input aria-label="搜索期刊会议资料" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索名称、简称、出版方或研究领域" />{query && <button type="button" aria-label="清除搜索" onClick={() => onQueryChange("")}><X size={14} /></button>}</label>
  </div>;
}

function VenueLogo({ venue, large = false }: { venue?: VenueProfile; large?: boolean }) {
  const asset = venueLogoAsset(venue);
  const [failed, setFailed] = useState(false);
  const src = asset?.status === "ready" ? asset.displayPath : null;
  useEffect(() => setFailed(false), [src]);
  return <span className={`venue-logo ${large ? "venue-logo-large" : ""}`}>
    {src && !failed ? <img src={src} alt={`${venue?.abbreviation || venue?.name || "发表渠道"} 官网图标`} loading={large ? "eager" : "lazy"} onError={() => setFailed(true)} />
      : <BookOpen aria-label="默认渠道图标" size={large ? 28 : 19} />}
  </span>;
}

function VenueMetrics({ venue }: { venue?: VenueProfile }) {
  const metric = venue?.impact_factor;
  if (!metric || metric.status === "not_applicable" || metric.status === "not_found") return null;
  return <section className="venue-metrics" aria-label="年度影响因子">
    <h3>{metric.metric}</h3>
    <div className="venue-metric-table-wrap"><table>
      <thead><tr>{Object.keys(metric.years).sort().map((year) => <th key={year} scope="col">{year}</th>)}</tr></thead>
      <tbody><tr>{Object.entries(metric.years).sort(([a], [b]) => a.localeCompare(b)).map(([year, value]) => <td key={year}>{value ?? "—"}</td>)}</tr></tbody>
    </table></div>
    {metric.source_scope && <p>{metric.source_scope}</p>}
    {Boolean(metric.sources.length) && <div className="venue-metric-sources">{metric.sources.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}<ArrowUpRight size={15} /></strong>{source.information && <span>{source.information}</span>}</a>)}</div>}
  </section>;
}

function impactFactor2025(venue?: VenueProfile): string {
  const value = venue?.type === "期刊" ? venue.impact_factor?.years["2025"] : null;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

export function VenueLibrary({ records, resumes, initialId, query, type, system, rank, onReview, onSelectEvidence }: Props) {
  const [selectedId, setSelectedId] = useState(initialId ?? "");
  const references = useMemo(() => new Map(records.map((record) => [record.id, resumes.flatMap((resume) => {
    const evidence = findKnowledgeMatch(resume.text, record);
    return evidence ? [{ resume, evidence }] : [];
  })])), [records, resumes]);
  const filtered = useMemo(() => {
    const keywords = query.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return records.filter((record) => (!type || record.venue?.type === type)
      && (system === "unlisted" ? !record.venue?.rankings.length : (!system && !rank) || record.venue?.rankings.some((item) =>
        (!system || JSON.stringify([item.system, item.edition, item.year]) === system) && (!rank || item.rank === rank)))
      && keywords.every((keyword) => venueSearchText(record).includes(keyword)))
      .sort((a, b) => (!query && !type && !system && !rank
        ? Number(b.venue?.type === "期刊") - Number(a.venue?.type === "期刊")
        : 0));
  }, [records, query, type, system, rank]);
  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0];
  const venue = selected?.venue;
  useEffect(() => { if (initialId) setSelectedId(initialId); }, [initialId]);

  return <main className="competition-library venue-library">
    <div className="competition-workspace">
      <aside className="competition-list" aria-label="期刊会议列表">
        <div className="competition-list-heading"><span>发表渠道 <b>{filtered.length}</b><small> / {records.length}</small></span></div>
        <div className="competition-items">{filtered.map((record) => <button key={record.id} className={`competition-item venue-item ${record.id === selected?.id ? "selected" : ""}`} aria-pressed={record.id === selected?.id} onClick={() => setSelectedId(record.id)}>
          <div className="venue-item-identity"><VenueLogo venue={record.venue} /><div><strong>{record.venue?.abbreviation || record.title}</strong>{record.venue?.abbreviation && record.venue.abbreviation !== record.title && <span className="venue-full-name">{record.title}</span>}</div><ArrowUpRight size={14} /></div><span className="venue-item-topline">{record.venue?.type ?? "类型待补充"} · {record.venue?.scope ?? record.region}</span><span>{record.summary || "暂无简介"}</span>
          {record.venue?.type === "期刊" && <div className="venue-item-impact" aria-label={`2025 年影响因子：${impactFactor2025(record.venue)}`}><span>2025 影响因子</span><b>{impactFactor2025(record.venue)}</b></div>}
          <footer><span className="catalog-card-material-meta"><small>{record.venue?.rankings.map((item) => `${item.year} ${item.rank}`).join(" · ") || "未登记分级"}</small><MaterialScoreSummary scores={record.materialScores} /></span><small>{references.get(record.id)?.length ? `${references.get(record.id)!.length} 份简历引用` : `${record.evidenceSources?.length ?? 0} 个来源`}</small></footer>
        </button>)}{!filtered.length && <div className="competition-empty"><Search size={24} /><strong>没有找到相关期刊或会议</strong><p>试试其他关键词或清除顶栏筛选条件。</p></div>}</div>
      </aside>
      <article className="competition-detail venue-detail" aria-label="期刊会议详细资料" key={selected?.id ?? "empty"}>
        {selected ? <>
          <div className="venue-detail-identity"><VenueLogo venue={venue} large /><div><h2>{selected.title}</h2>{selected.summary && <p className="competition-intro">{selected.summary}</p>}</div></div>
          <div className="venue-tags">{(venue?.field ?? [selected.field]).filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div>
          {(venue?.type || selected.organizer || selected.officialUrl) && <dl className="competition-facts">{venue?.type && <div><dt>类型</dt><dd>{venue.type}{venue.scope ? ` · ${venue.scope}` : ""}</dd></div>}{selected.organizer && <div><dt>组织 / 出版</dt><dd>{selected.organizer}</dd></div>}{selected.officialUrl && <div><dt>官方网站</dt><dd><a href={selected.officialUrl} target="_blank" rel="noreferrer">访问官网<ArrowUpRight size={15} /></a></dd></div>}</dl>}
          {venue?.info && venue.info !== selected.summary && <section className="competition-copy"><h3>渠道介绍</h3><p>{venue.info}</p></section>}
          {(venue?.influence || venue?.difficulty) && <div className="competition-dimensions">{venue.influence && <section><h3>学术影响力</h3><p>{venue.influence}</p></section>}{venue.difficulty && <section><h3>发表难度</h3><p>{venue.difficulty}</p></section>}</div>}
          {Boolean(venue?.rankings.length) && <section className="venue-rankings"><h3>目录分级</h3>{venue!.rankings.map((item, index) => <section className="venue-ranking" key={index}>
            <header><strong>{item.rank}</strong><div><b>{item.system}</b><span>{item.edition} · {item.year} · {item.category}</span></div></header>
            <dl><div><dt>发布机构</dt><dd>{item.issuer}</dd></div><div><dt>适用范围</dt><dd>{item.applies_to}</dd></div></dl>
            <a href={item.source_url} target="_blank" rel="noreferrer">查看分级来源<ArrowUpRight size={15} /></a>
          </section>)}{venue?.ranking_note && <p className="venue-ranking-note">{venue.ranking_note}</p>}</section>}
          <VenueMetrics venue={venue} />
          {Boolean(venue?.sources.length || selected.evidenceSources?.length) && <section className="competition-sources venue-sources"><h3>信息来源</h3>{venue?.sources.length ? venue.sources.map((source, index) => <a href={source.url} key={`${source.url}-${index}`} target="_blank" rel="noreferrer"><div><strong>{source.title}</strong>{source.information && <p>{source.information}</p>}</div><ArrowUpRight size={17} /></a>) : selected.evidenceSources?.map((source) => <a href={source.url} key={source.id} target="_blank" rel="noreferrer"><div><strong>{source.title}</strong>{source.note && <p>{source.note}</p>}</div><ArrowUpRight size={17} /></a>)}</section>}
          {Boolean(selected.materialScores?.length) && <MaterialScoreLibrary scores={selected.materialScores} onSelectEvidence={onSelectEvidence} />}
          <div className="competition-review-link"><button onClick={() => onReview(selected.id)}>人工评估与资料管理<ArrowUpRight size={14} /></button></div>
          {Boolean(references.get(selected.id)?.length) && <section className="competition-references"><h3>包含此渠道线索的简历</h3>{references.get(selected.id)!.map(({ resume, evidence }) => <button key={resume.id} onClick={() => onSelectEvidence(resume.id, evidence)}><span>{resume.name}</span><small>原文：{evidence}</small><ArrowUpRight size={14} /></button>)}</section>}
        </> : <div className="competition-empty"><BookOpen size={28} /><strong>暂无可展示的渠道</strong><p>调整筛选条件后查看资料。</p></div>}
      </article>
    </div>
  </main>;
}
