import { useState } from "react";
import {
  abilityDimensions,
  materialTypeLabels,
  scoringVersion,
  type AbilityKey,
  type Assessment,
  type AssessmentHistoryEntry,
  type Evidence,
} from "../shared/material-scoring";

export const formatPoints = (value: number | null | undefined) =>
  value == null ? "NA" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
export function EvidenceLink({
  evidence,
  onEvidence,
}: {
  evidence: Evidence;
  onEvidence: (quote: string) => void;
}) {
  return (
    <span className="ms-evidence">
      {evidence.origin === "resume" ? (
        <button type="button" onClick={() => onEvidence(evidence.quote)} title={evidence.quote}>
          原文：{evidence.quote}
        </button>
      ) : (
        <>
          <span>{evidence.quote}</span>
          {evidence.url && /^https?:\/\//i.test(evidence.url) && (
            <a href={evidence.url} target="_blank" rel="noreferrer">
              {evidence.source} ↗
            </a>
          )}
          {evidence.path && <small>报告字段：{evidence.path}</small>}
        </>
      )}
    </span>
  );
}
function AbilityRadar({
  assessment,
  onSelect,
}: {
  assessment: Assessment;
  onSelect: (key: AbilityKey) => void;
}) {
  const maximum = Math.max(50, ...abilityDimensions.map(({ key }) => assessment.abilities[key].score ?? 0));
  const scale = Math.ceil(maximum / 50) * 50;
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
    return [175 + (Math.cos(angle) * 100 * value) / scale, 140 + (Math.sin(angle) * 100 * value) / scale];
  };
  const allKnown = abilityDimensions.every(({ key }) => assessment.abilities[key].score !== null);
  return (
    <svg
      className="ms-radar"
      viewBox="0 0 350 290"
      role="img"
      aria-label={`五维能力图，统一刻度上限 ${scale} 分，NA 维度不绘制分数点`}
    >
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <g key={ratio}>
          <polygon
            points={abilityDimensions.map((_, i) => point(i, scale * ratio).join(",")).join(" ")}
            className="ms-radar-grid"
          />
          <text x="180" y={140 - 100 * ratio + 12} className="ms-radar-tick">
            {scale * ratio}
          </text>
        </g>
      ))}
      {allKnown && (
        <polygon
          points={abilityDimensions
            .map(({ key }, i) => point(i, assessment.abilities[key].score!).join(","))
            .join(" ")}
          className="ms-radar-area"
        />
      )}
      {abilityDimensions.map(({ key, label }, index) => {
        const [x, y] = point(index, scale * 1.25);
        const score = assessment.abilities[key].score;
        const [px, py] = point(index, score ?? 0);
        return (
          <g key={key}>
            <line
              x1="175"
              y1="140"
              x2={point(index, scale)[0]}
              y2={point(index, scale)[1]}
              className="ms-radar-grid"
            />
            {score !== null && <circle cx={px} cy={py} r="4" className="ms-radar-dot" />}
            <g
              role="button"
              tabIndex={0}
              onClick={() => onSelect(key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(key);
                }
              }}
              aria-label={`查看${label}依据`}
            >
              <text x={x} y={y} textAnchor="middle" className="ms-radar-label">
                {label}
              </text>
              <text x={x} y={y + 15} textAnchor="middle" className="ms-radar-value">
                {formatPoints(score)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
export default function MaterialAssessment({
  assessment,
  history = [],
  onEvidence,
  compact = false,
}: {
  assessment: Assessment;
  history?: AssessmentHistoryEntry[];
  onEvidence: (quote: string) => void;
  compact?: boolean;
}) {
  const [dimension, setDimension] = useState<AbilityKey>("professional_execution");
  const [historyId, setHistoryId] = useState("");
  const selectedHistory = history.find((entry) => entry.assessment.id === historyId)?.assessment;
  const current = selectedHistory ?? assessment;
  const ability = current.abilities[dimension];
  const years = [
    ...new Set(current.materials.flatMap((m) => String(m.year ?? "").match(/(?:19|20)\d{2}/g) ?? [])),
  ].sort();
  return (
    <section className={`material-assessment ${compact ? "ms-compact" : ""}`} aria-label="材料派生能力评分">
      <div className="ms-section-heading">
        <div>
          <span className="ms-eyebrow">EVIDENCE → ABILITY</span>
          <h2>五维能力画像</h2>
          <p>分数由材料和个人行动派生 · 积分可超过 100 · NA 表示证据不足</p>
        </div>
        <span className="ms-version">{current.version}</span>
      </div>
      {history.length > 0 && (
        <label className="ms-history-select">
          评估记录
          <select value={historyId} onChange={(event) => setHistoryId(event.target.value)}>
            <option value="">当前评估 · {new Date(assessment.evaluatedAt).toLocaleString("zh-CN")}</option>
            {history
              .filter((entry) => entry.assessment.id !== assessment.id)
              .map((entry) => (
                <option key={entry.assessment.id} value={entry.assessment.id}>
                  {new Date(entry.assessment.evaluatedAt).toLocaleString("zh-CN")} ·{" "}
                  {entry.assessment.version}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="ms-profile-grid">
        <AbilityRadar assessment={current} onSelect={setDimension} />
        <div className="ms-abilities">
          {abilityDimensions.map(({ key, label }) => (
            <button
              type="button"
              key={key}
              className={dimension === key ? "active" : ""}
              onClick={() => setDimension(key)}
            >
              <span>{label}</span>
              <strong>{formatPoints(current.abilities[key].score)}</strong>
              <small>
                {current.abilities[key].score === null
                  ? "证据不足"
                  : current.abilities[key].provisional
                    ? "暂定积分"
                    : "因素完整"}{" "}
                · {current.abilities[key].terms.length} 项支持
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="ms-experience-summary">
        <span>{current.materials.length} 项材料</span>
        <span>{current.type_summaries.filter((t) => t.count > 0).length} 类经历</span>
        <span>
          {years.length ? `${years[0]}${years.length > 1 ? ` — ${years.at(-1)}` : ""}` : "年份待核实"}
        </span>
        <span>{current.extraction === "model" ? "模型提取 · 规则计分" : "规则提取 · 规则计分"}</span>
      </div>
      <section className="ms-contribution-section">
        <h3>{abilityDimensions.find((d) => d.key === dimension)?.label} · 贡献拆解</h3>
        <p>先在各材料类型内部按派生贡献排序，再按 {current.rho} 递减；不同类型分别从权重 1 开始。</p>
        {ability.terms.length ? (
          <div className="ms-terms">
            {ability.terms.map((term) => (
              <article key={term.material_id}>
                <div>
                  <span>
                    {materialTypeLabels[term.material_type]} · 本类型第 {term.rank} 项
                  </span>
                  <strong>{term.title}</strong>
                </div>
                <div className="ms-term-formula">
                  {formatPoints(term.material_score)} × {term.type_coefficient} × {term.mapping_coefficient} ×{" "}
                  {formatPoints(term.decay)} = <b>{formatPoints(term.contribution)}</b>
                </div>
                {term.evidence.map((e, index) => (
                  <EvidenceLink key={index} evidence={e} onEvidence={onEvidence} />
                ))}
              </article>
            ))}
          </div>
        ) : (
          <div className="ms-empty">未找到支持该维度的个人行动证据。材料质量不自动代表个人能力。</div>
        )}
      </section>
      {!compact && current.materials.some((material) => material.year !== null) && (
        <details className="ms-timeline">
          <summary>经历时间线与材料类型积累</summary>
          <p>年份用于回看任务、行动与交付变化。材料数量增加或年份变新本身不计进步分。</p>
          <div className="ms-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>年份 / 阶段</th>
                  <th>材料</th>
                  <th>个人行动原文</th>
                </tr>
              </thead>
              <tbody>
                {[...current.materials]
                  .filter((m) => m.year !== null)
                  .sort((a, b) => String(a.year).localeCompare(String(b.year)))
                  .map((m) => (
                    <tr key={m.material_id}>
                      <td>{m.year}</td>
                      <td>{m.title}</td>
                      <td>
                        {m.personal_action_evidence.length
                          ? m.personal_action_evidence.map((e, i) => (
                              <EvidenceLink key={i} evidence={e} onEvidence={onEvidence} />
                            ))
                          : "个人行动待核实"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="ms-experience-summary">
            {current.type_summaries
              .filter((item) => item.count)
              .map((item) => (
                <span key={item.type}>
                  {materialTypeLabels[item.type]}：{item.count} 项 · 类型积累 {formatPoints(item.score)}
                  （仅展示）
                </span>
              ))}
          </div>
        </details>
      )}
      {!compact && (
        <section className="ms-material-section">
          <div className="ms-section-heading">
            <div>
              <h3>材料与评分依据</h3>
              <p>展开每项材料，查看因素、缺口及个人行动映射。</p>
            </div>
          </div>
          {current.materials.length ? (
            current.materials.map((m) => (
              <details className="ms-material" key={m.material_id} open={current.materials.length === 1}>
                <summary>
                  <span>
                    <small>
                      {materialTypeLabels[m.material_type]} · {m.year ?? "年份待核实"}
                    </small>
                    <strong>{m.title}</strong>
                  </span>
                  <span>
                    <b>{formatPoints(m.material_score)}</b>
                    <small>
                      因素覆盖 {Math.round(m.score_coverage * 100)}%{m.provisional ? " · 暂定" : ""}
                    </small>
                  </span>
                </summary>
                <div className="ms-material-body">
                  <blockquote>{m.resume_claim}</blockquote>
                  <button className="ms-text-button" onClick={() => onEvidence(m.resume_claim)}>
                    定位原文 ↗
                  </button>
                  <div className="ms-tags">
                    {m.evidence_states.map((state) => (
                      <span key={state}>{state}</span>
                    ))}
                    {m.merged_from.length > 1 && <span>合并了 {m.merged_from.length} 条重复记录</span>}
                  </div>
                  <div className="ms-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>因素</th>
                          <th>事实 / 档位</th>
                          <th>积分</th>
                          <th>权重</th>
                          <th>贡献</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.score_breakdown.map((f) => (
                          <tr key={f.key}>
                            <td>{f.label}</td>
                            <td>{f.points === null ? "NA" : f.reason}</td>
                            <td>{formatPoints(f.points)}</td>
                            <td>{Math.round(f.weight * 100)}%</td>
                            <td>{formatPoints(f.contribution)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {m.missing_factors.length > 0 && (
                    <p className="ms-missing">
                      待补因素：{m.missing_factors.join("、")}。缺失因素未填零，暂定分未按覆盖率放大。
                    </p>
                  )}
                  <div className="ms-mappings">
                    {abilityDimensions.map(({ key, label }) => {
                      const mapping = m.dimension_mapping[key];
                      return (
                        <div key={key}>
                          <strong>{label}</strong>
                          <span>
                            R={mapping.type_coefficient} · A={mapping.mapping_coefficient ?? "NA"} · 派生贡献{" "}
                            {formatPoints(mapping.derived_contribution)}
                          </span>
                          <small>{mapping.mapping_reason}</small>
                        </div>
                      );
                    })}
                  </div>
                  <details>
                    <summary>逐项事实来源</summary>
                    {m.score_breakdown
                      .filter((f) => f.evidence)
                      .map((f) => (
                        <div className="ms-factor-evidence" key={f.key}>
                          <strong>{f.label}</strong>
                          <EvidenceLink evidence={f.evidence!} onEvidence={onEvidence} />
                        </div>
                      ))}
                  </details>
                  {m.notes.length > 0 && (
                    <details>
                      <summary>材料限制与待核实事项 · {m.notes.length}</summary>
                      <ul>
                        {m.notes.map((note, i) => (
                          <li key={i}>{note}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <details>
                    <summary>原始材料与计算明细 JSON</summary>
                    <pre>{JSON.stringify(m, null, 2)}</pre>
                  </details>
                </div>
              </details>
            ))
          ) : (
            <div className="ms-empty">
              尚未提取到明确材料。补充项目、奖项、论文或工作任务的原文后可重新评估。
            </div>
          )}
        </section>
      )}
      {current.notes.length > 0 && (
        <details className="ms-notes">
          <summary>本次评估说明 · {current.notes.length}</summary>
          <ul>
            {current.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      <footer className="ms-assessment-footer">
        <span>{current.calibration}</span>
        <span>{new Date(current.evaluatedAt).toLocaleString("zh-CN")}</span>
        <small>规则与输入快照已保留 · 版本 {scoringVersion}</small>
      </footer>
    </section>
  );
}
