import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, Search, Trophy } from "lucide-react";
import { competitionSearchText } from "../shared/competitions";
import { competitionLogoAsset, competitionLogoLabels } from "../shared/competition-assets";
import type { CompetitionProfile } from "../shared/competitions";
import { findKnowledgeMatch, type KnowledgeRecord } from "../shared/knowledge";
import type { Resume } from "./types";
import MaterialScoreLibrary, { MaterialScoreSummary } from "./MaterialScoreLibrary";
import "./competition-library.css";

type Props = {
  records: KnowledgeRecord[];
  resumes: Resume[];
  initialId?: string;
  query: string;
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

export function CompetitionLibrary({ records, resumes, initialId, query, onReview, onSelectEvidence }: Props) {
  const [selectedId, setSelectedId] = useState(initialId ?? records[0]?.id ?? "");
  const references = useMemo(() => new Map(records.map((record) => [record.id, resumes.flatMap((resume) => {
    const evidence = findKnowledgeMatch(resume.text, record);
    return evidence ? [{ resume, evidence }] : [];
  })])), [records, resumes]);
  const filtered = useMemo(() => {
    const keywords = query.trim().normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return records.filter((record) => keywords.every((keyword) => competitionSearchText(record).includes(keyword)));
  }, [records, query]);
  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0];
  const profile = selected?.competition;

  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);

  return <main className="competition-library">
    <div className="competition-workspace">
      <aside className="competition-list" aria-label="竞赛列表">
        <div className="competition-list-heading"><span>全部竞赛 <b>{filtered.length}</b><small> / {records.length}</small></span></div>
        <div className="competition-items">{filtered.map((record) => <button key={record.id} className={`competition-item ${record.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(record.id)} aria-pressed={record.id === selected?.id}>
          <div className="competition-card-title"><CompetitionLogo profile={record.competition} /><strong><span>{record.title}</span></strong></div><span className="competition-item-top"><small>{record.field || "领域待补充"}</small><ArrowUpRight size={14} /></span><span>{record.summary || "暂无简介"}</span>
          <footer><span className="catalog-card-material-meta"><small>{record.origin ? "自动整理" : "赛事资料"}</small><MaterialScoreSummary scores={record.materialScores} /></span><small>{record.evidenceSources?.length ?? 0} 个来源{references.get(record.id)?.length ? ` · ${references.get(record.id)!.length} 份简历引用` : ""}</small></footer>
        </button>)}{!filtered.length && <div className="competition-empty"><Search size={24} /><strong>没有找到相关竞赛</strong><p>试试其他关键词。</p></div>}</div>
      </aside>
      <article className="competition-detail" aria-label="竞赛详细资料" key={selected?.id ?? "empty"}>
        {selected ? <>
          <div className="competition-identity"><CompetitionLogo profile={profile} large /><div><h2>{selected.title}</h2></div></div>
          {selected.summary && <p className="competition-intro">{selected.summary}</p>}
          {(selected.organizer || selected.officialUrl) && <dl className="competition-facts">{selected.organizer && <div><dt>主办方</dt><dd>{selected.organizer}</dd></div>}{selected.officialUrl && <div><dt>赛事官网</dt><dd><a href={selected.officialUrl} target="_blank" rel="noreferrer">访问官方网站<ArrowUpRight size={15} /></a></dd></div>}</dl>}
          {profile?.info && profile.info !== selected.summary && <section className="competition-copy"><h3>赛事介绍</h3><p>{profile.info}</p></section>}
          {(profile?.influence || profile?.difficulty) && <div className="competition-dimensions">{profile.influence && <section><h3>赛事影响力</h3><p>{profile.influence}</p></section>}{profile.difficulty && <section><h3>参赛难度</h3><p>{profile.difficulty}</p></section>}</div>}
          <div className="competition-abilities">{Boolean(profile?.acquires.length) && <section><h3>需要具备的能力</h3><div>{profile!.acquires.map((ability) => <span key={ability}>{ability}</span>)}</div></section>}{Boolean(profile?.projection.length || selected.signals.length) && <section><h3>可反映的素质</h3><div>{(profile?.projection.length ? profile.projection : selected.signals).map((quality) => <span key={quality}>{quality}</span>)}</div></section>}</div>
          {profile?.notes && <section className="competition-notes"><h3>使用提示</h3><p>{profile.notes}</p></section>}
          {Boolean(selected.evidenceSources?.length) && <section className="competition-sources"><h3>信息来源</h3>{selected.evidenceSources!.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><div><strong>{source.title}</strong>{source.note && <p>{source.note}</p>}</div><ArrowUpRight size={17} /></a>)}</section>}
          {Boolean(selected.materialScores?.length) && <MaterialScoreLibrary scores={selected.materialScores} onSelectEvidence={onSelectEvidence} />}
          <div className="competition-review-link"><button onClick={() => onReview(selected.id)}>人工评估与资料管理<ArrowUpRight size={14} /></button></div>
          {Boolean(references.get(selected.id)?.length) && <section className="competition-references"><h3>引用此赛事的简历</h3>{references.get(selected.id)!.map(({ resume, evidence }) => <button key={resume.id} onClick={() => onSelectEvidence(resume.id, evidence)}><span>{resume.name}</span><small>原文：{evidence}</small><ArrowUpRight size={14} /></button>)}</section>}
        </> : <div className="competition-empty"><BookOpen size={28} /><strong>暂无可展示的赛事</strong><p>调整筛选条件后查看赛事资料。</p></div>}
      </article>
    </div>
  </main>;
}
