import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Search, X } from "lucide-react";
import { findKnowledgeMatch, type KnowledgeRecord } from "../shared/knowledge";
import { venueSearchText } from "../shared/venues";
import type { Resume } from "./types";
import "./venue-library.css";

type Props = {
  records: KnowledgeRecord[];
  resumes: Resume[];
  initialId?: string;
  onClose: () => void;
  onReview: (id: string) => void;
  onSelectEvidence: (resumeId: string, evidence: string) => void;
};

export function VenueLibrary({ records, resumes, initialId, onClose, onReview, onSelectEvidence }: Props) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [field, setField] = useState("");
  const [system, setSystem] = useState("");
  const [rank, setRank] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(initialId ?? records[0]?.id ?? "");
  const fields = useMemo(() => [...new Set(records.flatMap((record) => record.venue?.field ?? [record.field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), [records]);
  const systems = useMemo(() => [...new Set(records.flatMap((record) => record.venue?.rankings.map((item) => JSON.stringify([item.system, item.edition, item.year])) ?? []))], [records]);
  const ranks = useMemo(() => [...new Set(records.flatMap((record) => record.venue?.rankings.filter((item) => !system || JSON.stringify([item.system, item.edition, item.year]) === system).map((item) => item.rank) ?? []))].sort(), [records, system]);
  const references = useMemo(() => new Map(records.map((record) => [record.id, resumes.flatMap((resume) => {
    const evidence = findKnowledgeMatch(resume.text, record);
    return evidence ? [{ resume, evidence }] : [];
  })])), [records, resumes]);
  const filtered = useMemo(() => {
    const keywords = query.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return records.filter((record) => (!type || record.venue?.type === type)
      && (!field || (record.venue?.field ?? [record.field]).includes(field))
      && (system === "unlisted" ? !record.venue?.rankings.length : (!system && !rank) || record.venue?.rankings.some((item) =>
        (!system || JSON.stringify([item.system, item.edition, item.year]) === system) && (!rank || item.rank === rank)))
      && (!linkedOnly || Boolean(references.get(record.id)?.length))
      && keywords.every((keyword) => venueSearchText(record).includes(keyword)));
  }, [records, query, type, field, system, rank, linkedOnly, references]);
  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0];
  const venue = selected?.venue;
  const clearFilters = () => { setQuery(""); setType(""); setField(""); setSystem(""); setRank(""); setLinkedOnly(false); };
  const hasFilters = Boolean(query || type || field || system || rank || linkedOnly);
  useEffect(() => { if (initialId) { clearFilters(); setSelectedId(initialId); } }, [initialId]);

  return <main className="competition-library venue-library">
    <header className="competition-heading">
      <div><span className="eyebrow">JOURNALS & CONFERENCES</span><h1>读懂论文背后的发表渠道<span>。</span></h1><p>查阅期刊与会议背景，结合分级版本、发表形式和来源理解研究经历。</p></div>
      <button className="competition-back" onClick={onClose}><ArrowLeft size={15} />返回简历分析</button>
    </header>
    <div className="competition-stats" aria-label="期刊会议库概况">
      <div><BookOpen size={17} /><span><strong>{records.filter((record) => record.venue).length}</strong> 已整理渠道</span></div>
      <div><span><strong>{records.filter((record) => record.venue?.type === "会议").length}</strong> 会议</span><span><strong>{records.filter((record) => record.venue?.type === "期刊").length}</strong> 期刊</span></div>
      <div><span><strong>{records.length}</strong> 全部条目</span><small>含原有及自建资料</small></div>
    </div>
    <section className="competition-tools venue-tools" aria-label="筛选期刊会议">
      <label className="competition-search"><Search size={17} /><input aria-label="搜索期刊会议资料" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、简称、出版方或研究领域…" />{query && <button aria-label="清除搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label>
      <label><span>渠道类型</span><select aria-label="期刊会议类型" value={type} onChange={(event) => setType(event.target.value)}><option value="">全部类型</option><option>会议</option><option>期刊</option></select></label>
      <label><span>研究领域</span><select aria-label="期刊会议领域" value={field} onChange={(event) => setField(event.target.value)}><option value="">全部研究领域</option>{fields.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>分级版本</span><select aria-label="分级体系与版本" value={system} onChange={(event) => { setSystem(event.target.value); setRank(""); }}><option value="">全部分级版本</option>{systems.map((key) => { const [name, edition] = JSON.parse(key); return <option value={key} key={key}>{name} · {edition}</option>; })}<option value="unlisted">未登记分级</option></select></label>
      <label><span>目录等级</span><select aria-label="目录等级" value={rank} disabled={system === "unlisted"} onChange={(event) => setRank(event.target.value)}><option value="">全部等级</option>{ranks.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className={`competition-linked ${linkedOnly ? "active" : ""}`} aria-pressed={linkedOnly} onClick={() => setLinkedOnly(!linkedOnly)}>{linkedOnly && <Check size={13} />}简历已引用</button>
    </section>
    <div className="competition-workspace">
      <aside className="competition-list" aria-label="期刊会议列表">
        <div className="competition-list-heading"><span>发表渠道 <b>{filtered.length}</b><small> / {records.length}</small></span>{hasFilters && <button onClick={clearFilters}>清除筛选</button>}</div>
        <div className="competition-items">{filtered.map((record) => <button key={record.id} className={`competition-item venue-item ${record.id === selected?.id ? "selected" : ""}`} aria-pressed={record.id === selected?.id} onClick={() => setSelectedId(record.id)}>
          <span className="competition-item-top"><small>{record.venue?.type ?? "类型待补充"} · {record.venue?.scope ?? record.region}</small><ArrowUpRight size={14} /></span>
          <strong>{record.venue?.abbreviation || record.title}</strong>{record.venue?.abbreviation !== record.title && <span className="venue-full-name">{record.title}</span>}<span>{record.summary || "暂无简介"}</span>
          <footer><small>{record.venue?.rankings.map((item) => `${item.year} ${item.rank}`).join(" · ") || "未登记分级"}</small><small>{references.get(record.id)?.length ? `${references.get(record.id)!.length} 份简历引用` : `${record.evidenceSources?.length ?? 0} 个来源`}</small></footer>
        </button>)}{!filtered.length && <div className="competition-empty"><Search size={24} /><strong>没有找到相关期刊或会议</strong><p>试试其他关键词或清除筛选条件。</p><button onClick={clearFilters}>清除筛选</button></div>}</div>
      </aside>
      <article className="competition-detail venue-detail" aria-label="期刊会议详细资料" key={selected?.id ?? "empty"}>
        {selected ? <>
          <div className="competition-detail-top"><span><BookOpen size={14} />{venue?.type ?? "发表渠道"} · {venue?.abbreviation ?? selected.title}</span><small>{selected.reviewHistory?.length ? `人工评估 ${selected.significanceScore} 分` : "待人工评估"}</small></div>
          <h2>{selected.title}</h2><p className="competition-intro">{selected.summary}</p>
          <div className="venue-tags">{(venue?.field ?? [selected.field]).filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div>
          <dl className="competition-facts"><div><dt>组织出版</dt><dd>{selected.organizer || "待补充"}</dd></div><div><dt>渠道背景</dt><dd>{venue?.scope || selected.region || "待补充"}</dd></div><div><dt>官方网站</dt><dd>{selected.officialUrl ? <a href={selected.officialUrl} target="_blank" rel="noreferrer">访问官网<ArrowUpRight size={13} /></a> : "暂无可确认的官网"}</dd></div>{venue && <><div><dt>常用别名</dt><dd>{[venue.abbreviation, ...venue.aliases].filter((value) => value !== venue.name).join("、") || "未登记"}</dd></div><div><dt>整理日期</dt><dd>{venue.checked_on} · {selected.origin ? "自动整理资料，待人工核验" : "本地整理资料"}</dd></div></>}</dl>
          <section className="competition-copy"><h3>渠道介绍</h3><p>{venue?.info || selected.summary || "详细介绍待补充。"}</p></section>
          <div className="competition-dimensions"><section><span>INFLUENCE</span><h3>学术影响力</h3><p>{venue?.influence || "暂无专项资料。"}</p></section><section><span>DIFFICULTY</span><h3>发表难度</h3><p>{venue?.difficulty || "暂无专项资料。"}</p></section></div>
          <section className="venue-rankings"><h3>目录分级与适用范围</h3>{venue?.rankings.length ? venue.rankings.map((item, index) => <section className="venue-ranking" key={index}>
            <header><strong>{item.rank}</strong><div><b>{item.system}</b><span>{item.edition} · {item.year} · {item.category}</span></div></header>
            <dl><div><dt>发布机构</dt><dd>{item.issuer}</dd></div><div><dt>适用范围</dt><dd>{item.applies_to}</dd></div><div><dt>资料核对说明</dt><dd>{item.verification}</dd></div></dl>
            <a href={item.source_url} target="_blank" rel="noreferrer">查看分级来源{item.source_pages?.length ? ` · PDF 第 ${item.source_pages.join("、")} 页` : ""}<ArrowUpRight size={12} /></a>
          </section>) : <p>未登记适用分级；不据此判断渠道质量或赋予低分。</p>}{venue?.ranking_note && <p className="venue-ranking-note">{venue.ranking_note}</p>}</section>
          <section className="venue-metrics"><h3>年度指标与收录</h3><p>影响因子、分区、录用率及完整收录信息：未核验。需按论文发表年份另行查证。</p></section>
          {Boolean(venue?.notes.length) && <section className="competition-notes"><h3>匹配与使用提示</h3>{venue!.notes.map((note, index) => <p key={index}>{note}</p>)}</section>}
          <section className="competition-sources venue-sources"><header><h3>信息来源</h3><small>{venue?.sources.length ?? selected.evidenceSources?.length ?? 0} 条资料</small></header>{venue ? venue.sources.map((source, index) => <a href={source.url} key={`${source.url}-${index}`} target="_blank" rel="noreferrer"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{source.title}</strong><small>{source.source_type} · {source.access} · 整理于 {venue.checked_on}</small><p>{source.information}</p><small>{source.url}</small></div><ArrowUpRight size={15} /></a>) : selected.evidenceSources?.map((source) => <a href={source.url} key={source.id} target="_blank" rel="noreferrer"><div><strong>{source.title}</strong><small>{source.url}</small></div><ArrowUpRight size={15} /></a>)}</section>
          <p className="competition-footnote">目录等级是指定版本的渠道背景，不代表单篇论文质量或个人贡献。A/B/C 与 T1/T2/T3 分属不同体系；历史论文、主会、Findings、Workshop 及文种需分别核验。</p>
          <div className="competition-review-link"><button onClick={() => onReview(selected.id)}>人工评估与资料管理<ArrowUpRight size={14} /></button></div>
          {Boolean(references.get(selected.id)?.length) && <section className="competition-references"><h3>包含此渠道线索的简历</h3>{references.get(selected.id)!.map(({ resume, evidence }) => <button key={resume.id} onClick={() => onSelectEvidence(resume.id, evidence)}><span>{resume.name}</span><small>原文：{evidence}</small><ArrowUpRight size={14} /></button>)}</section>}
        </> : <div className="competition-empty"><BookOpen size={28} /><strong>暂无可展示的渠道</strong><p>调整筛选条件后查看资料。</p></div>}
      </article>
    </div>
  </main>;
}
