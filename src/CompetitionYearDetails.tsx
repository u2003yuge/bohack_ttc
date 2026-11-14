import { useId, useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { CompetitionHistory, CompetitionYearMetric } from "../shared/competition-years";
import { competitionYearHasInformation } from "../shared/competition-years";

function Metric({ value }: { value: CompetitionYearMetric }) {
  const context = [value.unit?.trim() && `统计单位：${value.unit}`, value.scope?.trim() && `统计范围：${value.scope}`].filter(Boolean).join(" · ");
  return <>{value.reported}{context && <small>{context}</small>}</>;
}

export function CompetitionYearDetails({ history }: { history?: CompetitionHistory }) {
  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const id = useId();
  const years = Object.keys(history?.years ?? {}).filter((year) => competitionYearHasInformation(history!.years[year])).sort((a, b) => Number(a) - Number(b));
  const selected = expandedYear && years.includes(expandedYear) ? history?.years[expandedYear] : undefined;
  const categories = selected?.award_categories?.filter((category) => category.trim()) ?? [];
  const notes = selected?.notes.replace(/未查得字段\s*[:：][^。\n]*(?:。|$)/g, "").trim();
  const hasFacts = selected && Boolean(selected.edition?.trim() || selected.status?.trim() || selected.status_basis?.trim()
    || selected.participants?.reported.trim() || categories.length || selected.award_rate?.trim()
    || selected.awards?.reported.trim() || selected.bonuses?.reported.trim());
  if (!years.length) return null;
  return <section className="competition-year-history" aria-label="历年比赛情况">
    <header><h3>历年比赛情况</h3>{history && <small>整理于 {history.checked_at}</small>}</header>
    <>
      <div className="competition-year-buttons" role="group" aria-label="选择比赛年份，再次点击收起">
        {years.map((year) => <button key={year} type="button" id={`${id}-button-${year}`}
          aria-expanded={expandedYear === year} aria-controls={`${id}-panel-${year}`}
          onClick={() => setExpandedYear((current) => current === year ? null : year)}>
          {year}<ChevronDown size={14} aria-hidden="true" />
        </button>)}
      </div>
      {!selected && <p className="competition-year-hint">点击年份查看当年的参赛规模、奖项与奖金。</p>}
      {years.map((year) => <div key={year} id={`${id}-panel-${year}`} role="region" aria-labelledby={`${id}-button-${year}`} hidden={expandedYear !== year}>
        {expandedYear === year && selected && <div className="competition-year-panel">
          <h4>{year} 年比赛情况</h4>
          {hasFacts && <dl className="competition-facts">
            {selected.edition?.trim() && <div><dt>届次</dt><dd>{selected.edition}</dd></div>}
            {selected.status?.trim() && <div><dt>赛事状态</dt><dd>{selected.status}{selected.status_basis?.trim() && <small>判断依据：{selected.status_basis}</small>}</dd></div>}
            {!selected.status?.trim() && selected.status_basis?.trim() && <div><dt>状态依据</dt><dd>{selected.status_basis}</dd></div>}
            {selected.participants?.reported.trim() && <div><dt>参赛规模</dt><dd><Metric value={selected.participants} /></dd></div>}
            {categories.length > 0 && <div><dt>奖项类别</dt><dd>{categories.join("、")}</dd></div>}
            {selected.award_rate?.trim() && <div><dt>获奖比例</dt><dd>{selected.award_rate}</dd></div>}
            {selected.awards?.reported.trim() && <div><dt>奖项情况</dt><dd><Metric value={selected.awards} /></dd></div>}
            {selected.bonuses?.reported.trim() && <div><dt>奖金 / 奖励</dt><dd>{selected.bonuses.reported}{(selected.bonuses.currency?.trim() || selected.bonuses.scope?.trim()) && <small>{[selected.bonuses.currency?.trim() && `币种 / 奖励形式：${selected.bonuses.currency}`, selected.bonuses.scope?.trim() && `适用范围：${selected.bonuses.scope}`].filter(Boolean).join(" · ")}</small>}</dd></div>}
          </dl>}
          {notes && <p className="competition-year-notes">{notes}</p>}
          {selected.sources.length > 0 && <section className="competition-sources" aria-label={`${year} 年信息来源`}>
            <header><h3>年度信息来源</h3><small>{selected.sources.length} 条</small></header>
            {selected.sources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{source.title}</strong><small>{source.url}</small></div><ArrowUpRight size={14} /></a>)}
          </section>}
        </div>}
      </div>)}
      {history?.notes && <p className="competition-year-notes">{history.notes}</p>}
    </>
  </section>;
}
