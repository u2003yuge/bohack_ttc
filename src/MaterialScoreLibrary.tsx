import { abilityDimensions, materialTypeLabels, type LibraryMaterialScore } from "../shared/material-scoring";
import { formatPoints } from "./MaterialAssessment";

export function MaterialScoreSummary({ scores }: { scores?: LibraryMaterialScore[] }) {
  if (!scores?.length) return <small className="catalog-card-material-score">材料分待评</small>;
  const values = scores.flatMap((entry) => entry.materialScore === null ? [] : [entry.materialScore]);
  if (!values.length) return <small className="catalog-card-material-score">材料分待补 · {scores.length} 条</small>;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = minimum === maximum ? formatPoints(maximum) : `${formatPoints(minimum)}–${formatPoints(maximum)}`;
  return <small className="catalog-card-material-score">材料分 {spread} / 100 · {scores.length} 条</small>;
}

export default function MaterialScoreLibrary({
  scores,
  onSelectEvidence,
}: {
  scores?: LibraryMaterialScore[];
  onSelectEvidence: (resumeId: string, evidence: string) => void;
}) {
  if (!scores?.length)
    return (
      <section className="catalog-material-scores">
        <h3>简历经历材料分</h3>
        <p>
          尚无简历经历关联到此条目。评分保存后会自动匹配并显示；这里是候选人材料分，不是资料本身的人工含金量评分。
        </p>
      </section>
    );
  const sorted = [...scores].sort(
    (a, b) =>
      b.evaluatedAt.localeCompare(a.evaluatedAt) ||
      a.candidateName.localeCompare(b.candidateName, "zh-CN") ||
      a.materialTitle.localeCompare(b.materialTitle, "zh-CN"),
  );
  return (
    <section className="catalog-material-scores">
      <header>
        <h3>简历经历材料分</h3>
      </header>
      {sorted.map((entry) => (
        <details key={`${entry.candidateId}:${entry.materialId}`} className="catalog-material-score-entry">
          <summary>
            <span>
              <strong>{entry.candidateId === "__catalog__" ? "资料库背景" : entry.candidateName}</strong>
              <small>
                {materialTypeLabels[entry.materialType]} · {entry.year ?? "年份待核实"} ·{" "}
                {entry.materialTitle}
              </small>
            </span>
            <span className="catalog-material-score-value">
              {entry.materialScore === null ? "待评分" : <><b>{formatPoints(entry.materialScore)} / 100</b><small>{Math.round(entry.scoreCoverage * 100)}% 覆盖{entry.provisional ? " · 暂定" : ""}</small></>}
            </span>
          </summary>
          <div className="catalog-material-score-body">
            <blockquote>{entry.resumeClaim}</blockquote>
            {entry.materialType === "award" && (entry.eventScore !== null || entry.performanceRatio !== null) && (
              <p className="catalog-award-score-method">
                赛事质量分 Q：{formatPoints(entry.eventScore)}；候选人表现比例 P：{entry.performanceRatio === null ? "NA" : `${Math.round(entry.performanceRatio * 100)}%`}；最终材料分 M = Q × P。
              </p>
            )}
            {entry.candidateId !== "__catalog__" && (
              <button
                className="catalog-material-evidence"
                onClick={() => onSelectEvidence(entry.candidateId, entry.resumeClaim)}
              >
                打开简历并定位原文
              </button>
            )}
            <h4>个人能力贡献</h4>
            <div className="catalog-dimension-contributions">
              <div className="catalog-dimension-heading">
                <span>维度</span>
                <span>候选人维度分</span>
                <span>本材料实际贡献</span>
              </div>
              {abilityDimensions.map(({ key, label }) => {
                const item = entry.abilityContributions[key];
                return (
                  <div key={key}>
                    <strong>{label}</strong>
                    <span>{formatPoints(item.score)}</span>
                    <span>
                      {formatPoints(item.contribution)}
                      {item.contribution !== null && (
                        <small>
                          {" "}
                          · D {formatPoints(item.derivedContribution)} × {formatPoints(item.decay)}
                        </small>
                      )}
                    </span>
                    {item.actionCoefficient === null && (
                      <small className="catalog-contribution-unknown">{item.reason}</small>
                    )}
                  </div>
                );
              })}
            </div>
            <details className="catalog-factor-details">
              <summary>材料因素与积分拆解</summary>
              <div className="catalog-factor-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>因素</th>
                      <th>事实档位</th>
                      <th>积分</th>
                      <th>权重</th>
                      <th>贡献</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.scoreBreakdown.map((factor) => (
                      <tr key={factor.key}>
                        <td>{factor.label}</td>
                        <td>{factor.points === null ? "NA" : factor.reason}</td>
                        <td>{formatPoints(factor.points)}</td>
                        <td>{Math.round(factor.weight * 100)}%</td>
                        <td>{formatPoints(factor.contribution)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {entry.missingFactors.length > 0 && (
                <p className="catalog-material-missing">
                  缺失：{entry.missingFactors.join("、")}。缺失信息保持 NA。
                </p>
              )}
            </details>
          </div>
        </details>
      ))}
    </section>
  );
}
