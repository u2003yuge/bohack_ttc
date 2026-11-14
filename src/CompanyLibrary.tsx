import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Building2, Search, X } from "lucide-react";
import { findKnowledgeMatch, type KnowledgeRecord } from "../shared/knowledge";
import type { Resume } from "./types";
import "./competition-library.css";

type Props = {
  records: KnowledgeRecord[];
  resumes: Resume[];
  initialId?: string;
  query: string;
  region: string;
  onQueryChange: (value: string) => void;
  onRegionChange: (value: string) => void;
  onReview: (id: string) => void;
  onSelectEvidence: (resumeId: string, evidence: string) => void;
};

type ToolbarProps = Pick<Props, "records" | "query" | "region" | "onQueryChange" | "onRegionChange">;

export function CompanyLibraryToolbar({ records, query, onQueryChange, region, onRegionChange }: ToolbarProps) {
  const regions = [...new Set(records.map((record) => record.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const hasFilters = Boolean(query || region);
  const clearFilters = () => { onQueryChange(""); onRegionChange(""); };
  return <div className="venue-section-tools company-section-tools" aria-label="筛选公司">
    {hasFilters && <button type="button" className="venue-clear-filters" onClick={clearFilters}>清除筛选</button>}
    <select aria-label="公司地区范围" value={region} onChange={(event) => onRegionChange(event.target.value)}><option value="">全部地区</option>{regions.map((value) => <option key={value}>{value}</option>)}</select>
    <label className="venue-section-search"><Search size={15} /><input aria-label="搜索公司资料" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索公司、别名、业务或能力" />{query && <button type="button" aria-label="清除搜索" onClick={() => onQueryChange("")}><X size={14} /></button>}</label>
  </div>;
}

function companyLogoUrl(record?: KnowledgeRecord): string | null {
  if (record?.logoPath) return record.logoPath;
  if (record?.logoUrl) return record.logoUrl;
  if (!record?.officialUrl) return null;
  try {
    const host = new URL(record.officialUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch { return null; }
}

function CompanyLogo({ record, large = false }: { record?: KnowledgeRecord; large?: boolean }) {
  const src = companyLogoUrl(record);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const initials = (record?.title ?? "公司").replace(/[（）()]/g, "").trim().slice(0, 2);
  return <span className={`company-logo ${large ? "company-logo-large" : ""}`}>
    {src && !failed ? <img src={src} alt={`${record?.title ?? "公司"} Logo`} loading={large ? "eager" : "lazy"} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <><Building2 size={large ? 26 : 19} /><b>{initials}</b></>}
  </span>;
}

export function CompanyLibrary({ records, resumes, initialId, query, region, onReview, onSelectEvidence }: Props) {
  const [selectedId, setSelectedId] = useState(initialId ?? records[0]?.id ?? "");
  const references = useMemo(() => new Map(records.map((record) => [record.id, resumes.flatMap((resume) => {
    const evidence = findKnowledgeMatch(resume.text, record);
    return evidence ? [{ resume, evidence }] : [];
  })])), [records, resumes]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return records.filter((record) => (!region || record.region === region)
      && (!keyword || `${record.title} ${record.aliases.join(" ")} ${record.field} ${record.organizer} ${record.summary} ${record.signals.join(" ")} ${record.company?.englishName ?? ""} ${record.company?.headquarters ?? ""} ${record.company?.businessScope ?? ""} ${record.company?.representativeProducts ?? ""} ${record.company?.info ?? ""}`.toLocaleLowerCase().includes(keyword)));
  }, [records, query, region]);
  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0];
  useEffect(() => { if (initialId) setSelectedId(initialId); }, [initialId]);

  return <main className="competition-library company-library">
    <div className="competition-workspace">
      <aside className="competition-list" aria-label="公司列表">
        <div className="competition-list-heading"><span>全部公司 <b>{filtered.length}</b><small> / {records.length}</small></span></div>
        <div className="competition-items">{filtered.map((record) => <button key={record.id} className={`competition-item company-item ${record.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(record.id)} aria-pressed={record.id === selected?.id}>
          <div className="company-item-identity"><CompanyLogo record={record} /><strong>{record.title}</strong><ArrowUpRight size={14} /></div><span className="company-item-field">{record.field || "业务领域待补充"}</span><span>{record.summary || "暂无简介"}</span>
          <footer><small>{record.region || "地区待补充"}</small><small>{references.get(record.id)?.length ? `${references.get(record.id)!.length} 份简历引用` : `${record.signals.length} 个观察点`}</small></footer>
        </button>)}{!filtered.length && <div className="competition-empty"><Search size={24} /><strong>没有找到相关公司</strong><p>试试其他关键词或清除顶栏筛选条件。</p></div>}</div>
      </aside>
      <article className="competition-detail company-detail" aria-label="公司详细资料" key={selected?.id ?? "empty"}>
        {selected ? <>
          <div className="company-detail-identity"><CompanyLogo record={selected} large /><div><h2>{selected.title}</h2><p className="competition-intro">{selected.summary}</p></div></div>
          <div className="venue-tags">{[selected.field, selected.region, ...selected.aliases].filter(Boolean).slice(0, 8).map((value) => <span key={value}>{value}</span>)}</div>
          {(selected.organizer || selected.company?.englishName || selected.company?.headquarters || selected.company?.foundedYear || selected.company?.businessScope || selected.company?.representativeProducts || selected.officialUrl) && <dl className="competition-facts">{selected.organizer && <div><dt>所属 / 主体</dt><dd>{selected.organizer}</dd></div>}{selected.company?.englishName && <div><dt>英文名称</dt><dd>{selected.company.englishName}</dd></div>}{selected.company?.headquarters && <div><dt>总部</dt><dd>{selected.company.headquarters}</dd></div>}{selected.company?.foundedYear && <div><dt>成立年份</dt><dd>{selected.company.foundedYear}</dd></div>}{selected.company?.businessScope && <div><dt>业务范围</dt><dd>{selected.company.businessScope}</dd></div>}{selected.company?.representativeProducts && <div><dt>代表产品 / 平台</dt><dd>{selected.company.representativeProducts}</dd></div>}{selected.officialUrl && <div><dt>官方网站</dt><dd><a href={selected.officialUrl} target="_blank" rel="noreferrer">访问官网<ArrowUpRight size={15} /></a></dd></div>}</dl>}
          {selected.company?.info && selected.company.info !== selected.summary && <section className="competition-copy"><h3>公司背景</h3><p>{selected.company.info}</p></section>}
          {selected.company?.influence && <section className="competition-copy"><h3>业务影响</h3><p>{selected.company.influence}</p></section>}
          {Boolean(selected.company?.publicSignals.length || selected.signals.length) && <section className="competition-abilities"><section><h3>公开资料线索</h3><div>{(selected.company?.publicSignals.length ? selected.company.publicSignals : selected.signals).map((signal) => <span key={signal}>{signal}</span>)}</div></section></section>}
          {(selected.company?.source.title || selected.evidenceSources?.length) && <section className="competition-sources"><h3>信息来源</h3>{selected.company?.source.title && <a href={selected.company.source.url} target="_blank" rel="noreferrer"><div><strong>{selected.company.source.title}</strong></div><ArrowUpRight size={17} /></a>}{selected.evidenceSources?.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><div><strong>{source.title}</strong>{source.note && <p>{source.note}</p>}</div><ArrowUpRight size={17} /></a>)}</section>}
          <div className="competition-review-link"><button onClick={() => onReview(selected.id)}>人工评估与资料管理<ArrowUpRight size={14} /></button></div>
          {Boolean(references.get(selected.id)?.length) && <section className="competition-references"><h3>引用此公司的简历</h3>{references.get(selected.id)!.map(({ resume, evidence }) => <button key={resume.id} onClick={() => onSelectEvidence(resume.id, evidence)}><span>{resume.name}</span><small>原文：{evidence}</small><ArrowUpRight size={14} /></button>)}</section>}
        </> : <div className="competition-empty"><Building2 size={28} /><strong>暂无可展示的公司</strong><p>调整筛选条件后查看资料。</p></div>}
      </article>
    </div>
  </main>;
}
