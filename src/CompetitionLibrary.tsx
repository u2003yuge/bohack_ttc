import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Search, Trophy, X } from "lucide-react";
import { competitionSearchText } from "../shared/competitions";
import { competitionLogoAsset, competitionLogoLabels } from "../shared/competition-assets";
import type { CompetitionProfile } from "../shared/competitions";
import { findKnowledgeMatch, type KnowledgeRecord } from "../shared/knowledge";
import type { Resume } from "./types";
import { CompetitionYearDetails } from "./CompetitionYearDetails";
import "./competition-library.css";

type Props = {
  records: KnowledgeRecord[];
  resumes: Resume[];
  initialId?: string;
  onClose: () => void;
  onReview: (id: string) => void;
  onSelectEvidence: (resumeId: string, evidence: string) => void;
};

function CompetitionLogo({ profile, large = false }: { profile?: CompetitionProfile; large?: boolean }) {
  const asset = competitionLogoAsset(profile);
  const src = asset?.status === "ready" ? asset.displayPath : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const label = asset?.displayKind ? competitionLogoLabels[asset.displayKind] : "竞赛图标";
  return <span className={`competition-logo ${large ? "competition-logo-large" : ""}`}>
    {src && !failed ? <img src={src} alt={`${profile?.name} · ${label}`} loading={large ? "eager" : "lazy"} onError={() => setFailed(true)} />
      : <Trophy aria-label="默认竞赛图标" size={large ? 28 : 19} />}
  </span>;
}

export function CompetitionLibrary({ records, resumes, initialId, onClose, onReview, onSelectEvidence }: Props) {
  const [query, setQuery] = useState("");
  const [field, setField] = useState("");
  const [year, setYear] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(initialId ?? records[0]?.id ?? "");
  const fields = useMemo(() => [...new Set(records.map((record) => record.field).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), [records]);
  const years = useMemo(() => [...new Set(records.flatMap((record) => record.competition ? [record.competition.report_year] : []))].sort((a, b) => b - a), [records]);
  const references = useMemo(() => new Map(records.map((record) => [record.id, resumes.flatMap((resume) => {
    const evidence = findKnowledgeMatch(resume.text, record);
    return evidence ? [{ resume, evidence }] : [];
  })])), [records, resumes]);
  const filtered = useMemo(() => {
    const keywords = query.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return records.filter((record) => (!field || record.field === field)
      && (!year || String(record.competition?.report_year) === year)
      && (!linkedOnly || Boolean(references.get(record.id)?.length))
      && keywords.every((keyword) => competitionSearchText(record).includes(keyword)));
  }, [records, query, field, year, linkedOnly, references]);
  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0];
  const profile = selected?.competition;
  const selectedLogo = competitionLogoAsset(profile);
  const catalogCount = records.filter((record) => record.competition).length;
  const clearFilters = () => { setQuery(""); setField(""); setYear(""); setLinkedOnly(false); };

  useEffect(() => {
    if (initialId) { setQuery(""); setField(""); setYear(""); setLinkedOnly(false); setSelectedId(initialId); }
  }, [initialId]);

  return <main className="competition-library">
    <header className="competition-heading">
      <div><span className="eyebrow">COMPETITION LIBRARY</span><h1>看懂每一项竞赛经历<span>。</span></h1><p>从赛事背景，到能力要求，为简历中的成果找到可追溯的参考。</p></div>
      <button className="competition-back" onClick={onClose}><ArrowLeft size={15} />返回简历分析</button>
    </header>
    <div className="competition-stats" aria-label="竞赛库概况">
      <div><BookOpen size={17} /><span><strong>{catalogCount}</strong> 已整理赛事</span></div>
      <div><span><strong>{records.length}</strong> 竞赛条目</span><small>含原有及自建资料</small></div>
      <div><span><strong>{years.join(" / ") || "—"}</strong> 资料年份</span><small>具体届次以当年章程为准</small></div>
    </div>
    <section className="competition-tools" aria-label="筛选竞赛">
      <label className="competition-search"><Search size={17} /><input aria-label="搜索竞赛资料" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索赛事、主办方、能力或素质…" />{query && <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={14} /></button>}</label>
      <label><span>学科领域</span><select aria-label="竞赛学科领域" value={field} onChange={(event) => setField(event.target.value)}><option value="">全部学科领域</option>{fields.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>目录年份</span><select aria-label="竞赛目录年份" value={year} onChange={(event) => setYear(event.target.value)}><option value="">全部年份</option>{years.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className={`competition-linked ${linkedOnly ? "active" : ""}`} onClick={() => setLinkedOnly(!linkedOnly)} aria-pressed={linkedOnly}>{linkedOnly && <Check size={13} />}简历已引用</button>
    </section>
    <div className="competition-workspace">
      <aside className="competition-list" aria-label="竞赛列表">
        <div className="competition-list-heading"><span>全部竞赛 <b>{filtered.length}</b><small> / {records.length}</small></span>{(query || field || year || linkedOnly) && <button onClick={clearFilters}>清除筛选</button>}</div>
        <div className="competition-items">{filtered.map((record) => <button key={record.id} className={`competition-item ${record.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(record.id)} aria-pressed={record.id === selected?.id}>
          <span className="competition-item-top"><small>{record.field || "领域待补充"}</small><ArrowUpRight size={14} /></span><div className="competition-card-title"><CompetitionLogo profile={record.competition} /><strong>{record.title}</strong></div><span>{record.summary || "暂无简介"}</span>
          <footer><small>{record.origin ? "自动整理" : record.competition ? `${record.competition.report_year} 目录` : "原有资料"}</small><small>{record.evidenceSources?.length ?? 0} 个来源{references.get(record.id)?.length ? ` · ${references.get(record.id)!.length} 份简历引用` : ""}</small></footer>
        </button>)}{!filtered.length && <div className="competition-empty"><Search size={24} /><strong>没有找到相关竞赛</strong><p>试试其他关键词或清除筛选条件。</p><button onClick={clearFilters}>清除筛选</button></div>}</div>
      </aside>
      <article className="competition-detail" aria-label="竞赛详细资料" key={selected?.id ?? "empty"}>
        {selected ? <>
          <div className="competition-detail-top"><span><Trophy size={14} />{selected.field || "竞赛资料"}</span><small>{selected.reviewHistory?.length ? `人工评估 ${selected.significanceScore} 分` : "待人工评估"}</small></div>
          <div className="competition-identity"><CompetitionLogo profile={profile} large /><div><h2>{selected.title}</h2><span>{selectedLogo?.status === "ready" && selectedLogo.displayKind ? competitionLogoLabels[selectedLogo.displayKind] : "默认竞赛图标"}</span></div></div><p className="competition-intro">{selected.summary}</p>
          {selectedLogo && <details className="competition-logo-provenance"><summary>图标来源与对应说明</summary><p>{selectedLogo.notes}</p>{selectedLogo.sourceUrl && <a href={selectedLogo.sourceUrl} target="_blank" rel="noreferrer">查看原图片来源<ArrowUpRight size={12} /></a>}<p>按原始赛事 ID {profile?.id}、名称及目录官网对应；网站、机构和平台图标不等同于赛事专属赛徽，也不改变人工核验状态。</p></details>}
          <dl className="competition-facts"><div><dt>主办方</dt><dd>{selected.organizer || "待补充"}</dd></div><div><dt>赛事官网</dt><dd>{selected.officialUrl ? <a href={selected.officialUrl} target="_blank" rel="noreferrer">访问官方网站<ArrowUpRight size={13} /></a> : "暂无可确认的官网"}</dd></div>{profile && <div><dt>资料出处</dt><dd>{selected.origin ? "自动整理赛事资料" : "已整理赛事目录"} · {selected.origin ? selected.origin.collectedAt.slice(0, 10) : profile.report_year}</dd></div>}</dl>
          <section className="competition-copy"><h3>赛事介绍</h3><p>{profile?.info || selected.summary || "详细介绍待补充。"}</p></section>
          <CompetitionYearDetails key={selected.id} history={profile?.history} />
          <div className="competition-dimensions"><section><span>INFLUENCE</span><h3>赛事影响力</h3><p>{profile?.influence || "暂无专项资料，需结合来源核实。"}</p></section><section><span>DIFFICULTY</span><h3>参赛难度</h3><p>{profile?.difficulty || "暂无专项资料，需结合具体届次与赛项判断。"}</p></section></div>
          <div className="competition-abilities"><section><h3>需要具备的能力</h3><div>{profile?.acquires?.length ? profile.acquires.map((ability) => <span key={ability}>{ability}</span>) : <p>能力要求待补充。</p>}</div></section><section><h3>可反映的素质</h3><div>{(profile?.projection ?? selected.signals).map((quality) => <span key={quality}>{quality}</span>)}</div></section></div>
          {profile?.notes && <section className="competition-notes"><h3>使用提示</h3><p>{profile.notes}</p></section>}
          <section className="competition-sources"><header><h3>信息来源</h3><small>{(selected.evidenceSources ?? []).length} 条可追溯资料</small></header>{(selected.evidenceSources ?? []).map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{source.title}</strong><small>{source.url}</small></div><ArrowUpRight size={15} /></a>)}{!selected.evidenceSources?.length && <p>尚未登记来源，可从人工审核入口补充。</p>}</section>
          <p className="competition-footnote">赛事背景用于理解经历；资料年份不等于获奖年份，个人能力仍需结合参赛角色、作品及获奖材料核实。</p>
          <div className="competition-review-link"><button onClick={() => onReview(selected.id)}>人工评估与资料管理<ArrowUpRight size={14} /></button></div>
          {Boolean(references.get(selected.id)?.length) && <section className="competition-references"><h3>引用此赛事的简历</h3>{references.get(selected.id)!.map(({ resume, evidence }) => <button key={resume.id} onClick={() => onSelectEvidence(resume.id, evidence)}><span>{resume.name}</span><small>原文：{evidence}</small><ArrowUpRight size={14} /></button>)}</section>}
        </> : <div className="competition-empty"><BookOpen size={28} /><strong>暂无可展示的赛事</strong><p>调整筛选条件后查看赛事资料。</p></div>}
      </article>
    </div>
  </main>;
}
