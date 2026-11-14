import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Building2, Check, Search, X } from "lucide-react";
import { findKnowledgeMatch, type KnowledgeRecord } from "../shared/knowledge";
import type { Resume } from "./types";
import "./competition-library.css";

type Props = {
  records: KnowledgeRecord[];
  resumes: Resume[];
  initialId?: string;
  onClose: () => void;
  onReview: (id: string) => void;
  onSelectEvidence: (resumeId: string, evidence: string) => void;
};

function companyLogoUrl(record?: KnowledgeRecord): string | null {
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
    {src && !failed ? <img src={src} alt={`${record?.title ?? "公司"}官网图标`} loading={large ? "eager" : "lazy"} onError={() => setFailed(true)} /> : <><Building2 size={large ? 26 : 19} /><b>{initials}</b></>}
  </span>;
}

export function CompanyLibrary({ records, resumes, initialId, onClose, onReview, onSelectEvidence }: Props) {
  const [query, setQuery] = useState("");
  const [field, setField] = useState("");
  const [region, setRegion] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(initialId ?? records[0]?.id ?? "");
  const fields = useMemo(() => [...new Set(records.map((record) => record.field).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), [records]);
  const regions = useMemo(() => [...new Set(records.map((record) => record.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), [records]);
  const references = useMemo(() => new Map(records.map((record) => [record.id, resumes.flatMap((resume) => {
    const evidence = findKnowledgeMatch(resume.text, record);
    return evidence ? [{ resume, evidence }] : [];
  })])), [records, resumes]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return records.filter((record) => (!field || record.field === field)
      && (!region || record.region === region)
      && (!linkedOnly || Boolean(references.get(record.id)?.length))
      && (!keyword || `${record.title} ${record.aliases.join(" ")} ${record.field} ${record.organizer} ${record.summary} ${record.signals.join(" ")}`.toLocaleLowerCase().includes(keyword)));
  }, [records, query, field, region, linkedOnly, references]);
  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0];
  const clearFilters = () => { setQuery(""); setField(""); setRegion(""); setLinkedOnly(false); };
  useEffect(() => { if (initialId) { clearFilters(); setSelectedId(initialId); } }, [initialId]);

  return <main className="competition-library company-library">
    <header className="competition-heading">
      <div><span className="eyebrow">COMPANY LIBRARY</span><h1>了解候选人经历背后的公司<span>。</span></h1><p>统一查看公司背景、业务领域和经历线索，把品牌信号还原为具体职责与结果。</p></div>
      <button className="competition-back" onClick={onClose}><ArrowLeft size={15} />返回简历分析</button>
    </header>
    <div className="competition-stats" aria-label="公司库概况">
      <div><Building2 size={17} /><span><strong>{records.length}</strong> 家公司</span></div>
      <div><span><strong>{new Set(records.flatMap((record) => record.region ? [record.region] : [])).size}</strong> 个地区范围</span></div>
      <div><span><strong>{records.filter((record) => record.officialUrl).length}</strong> 个官网入口</span><small>图标按官网域名获取</small></div>
    </div>
    <section className="competition-tools company-tools" aria-label="筛选公司">
      <label className="competition-search"><Search size={17} /><input aria-label="搜索公司资料" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、别名、业务或能力…" />{query && <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={14} /></button>}</label>
      <label><span>业务领域</span><select aria-label="公司业务领域" value={field} onChange={(event) => setField(event.target.value)}><option value="">全部业务领域</option>{fields.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>地区范围</span><select aria-label="公司地区范围" value={region} onChange={(event) => setRegion(event.target.value)}><option value="">全部地区</option>{regions.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className={`competition-linked ${linkedOnly ? "active" : ""}`} onClick={() => setLinkedOnly(!linkedOnly)} aria-pressed={linkedOnly}>{linkedOnly && <Check size={13} />}简历已引用</button>
    </section>
    <div className="competition-workspace">
      <aside className="competition-list" aria-label="公司列表">
        <div className="competition-list-heading"><span>全部公司 <b>{filtered.length}</b><small> / {records.length}</small></span>{(query || field || region || linkedOnly) && <button onClick={clearFilters}>清除筛选</button>}</div>
        <div className="competition-items">{filtered.map((record) => <button key={record.id} className={`competition-item company-item ${record.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(record.id)} aria-pressed={record.id === selected?.id}>
          <span className="competition-item-top"><small>{record.field || "业务领域待补充"}</small><ArrowUpRight size={14} /></span><div className="company-item-identity"><CompanyLogo record={record} /><strong>{record.title}</strong></div><span>{record.summary || "暂无简介"}</span>
          <footer><small>{record.region || "地区待补充"}</small><small>{references.get(record.id)?.length ? `${references.get(record.id)!.length} 份简历引用` : `${record.signals.length} 个观察点`}</small></footer>
        </button>)}{!filtered.length && <div className="competition-empty"><Search size={24} /><strong>没有找到相关公司</strong><p>试试其他关键词或清除筛选条件。</p><button onClick={clearFilters}>清除筛选</button></div>}</div>
      </aside>
      <article className="competition-detail company-detail" aria-label="公司详细资料" key={selected?.id ?? "empty"}>
        {selected ? <>
          <div className="competition-detail-top"><span><Building2 size={14} />{selected.field || "公司资料"}</span><small>{selected.reviewHistory?.length ? `人工评估 ${selected.significanceScore} 分` : "待人工评估"}</small></div>
          <div className="company-detail-identity"><CompanyLogo record={selected} large /><div><h2>{selected.title}</h2><p className="competition-intro">{selected.summary}</p></div></div>
          <div className="venue-tags">{[selected.field, selected.region, ...selected.aliases].filter(Boolean).slice(0, 8).map((value) => <span key={value}>{value}</span>)}</div>
          <dl className="competition-facts"><div><dt>所属 / 主体</dt><dd>{selected.organizer || "待补充"}</dd></div><div><dt>官方网站</dt><dd>{selected.officialUrl ? <a href={selected.officialUrl} target="_blank" rel="noreferrer">访问官网<ArrowUpRight size={13} /></a> : "暂无可确认的官网"}</dd></div><div><dt>图标来源</dt><dd>{selected.officialUrl ? "官网 favicon · 按域名自动获取" : "暂无官网入口，使用文字图标"}</dd></div></dl>
          <section className="competition-copy"><h3>公司背景</h3><p>{selected.summary || "详细介绍待补充。"}</p></section>
          <div className="competition-dimensions"><section><span>BUSINESS CONTEXT</span><h3>业务背景</h3><p>{selected.field || "业务领域待补充。"} · {selected.region || "地区待补充。"}</p></section><section><span>REVIEW BOUNDARY</span><h3>审核边界</h3><p>公司名称只提供组织背景，需结合候选人的团队、职责、项目结果和个人贡献判断。</p></section></div>
          <section className="competition-abilities"><section><h3>可观察的信号</h3><div>{selected.signals.length ? selected.signals.map((signal) => <span key={signal}>{signal}</span>) : <p>观察点待补充。</p>}</div></section></section>
          {selected.evidenceSources?.length ? <section className="competition-sources"><header><h3>信息来源</h3><small>{selected.evidenceSources.length} 条可追溯资料</small></header>{selected.evidenceSources.map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{source.title}</strong><small>{source.url}</small></div><ArrowUpRight size={15} /></a>)}</section> : null}
          <p className="competition-footnote">公司背景用于理解候选人经历，不代表录用结论；应优先核对具体岗位、团队、任职关系和可量化成果。</p>
          <div className="competition-review-link"><button onClick={() => onReview(selected.id)}>人工评估与资料管理<ArrowUpRight size={14} /></button></div>
          {Boolean(references.get(selected.id)?.length) && <section className="competition-references"><h3>引用此公司的简历</h3>{references.get(selected.id)!.map(({ resume, evidence }) => <button key={resume.id} onClick={() => onSelectEvidence(resume.id, evidence)}><span>{resume.name}</span><small>原文：{evidence}</small><ArrowUpRight size={14} /></button>)}</section>}
        </> : <div className="competition-empty"><Building2 size={28} /><strong>暂无可展示的公司</strong><p>调整筛选条件后查看资料。</p></div>}
      </article>
    </div>
  </main>;
}
