import { abilityDimensions, materialTypeLabels, type LibraryMaterialScore } from "../shared/material-scoring";
import { formatPoints } from "./MaterialAssessment";

export function materialScoreLabel(scores?: LibraryMaterialScore[]): string | null {
  if (!scores?.length) return null;
  const values = scores.flatMap((score) => (score.materialScore === null ? [] : [score.materialScore]));
  if (!values.length) return `材料分待补 · ${scores.length} 条经历`;
  const minimum = Math.min(...values),
    maximum = Math.max(...values);
  const spread =
    minimum === maximum ? formatPoints(maximum) : `${formatPoints(minimum)}–${formatPoints(maximum)}`;
  return `材料分 ${spread} · ${values.length} 条`;
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
        <div>
          <h3>简历经历材料分</h3>
          <p>按候选人、独立经历和年份保存；每项分数保留因素、来源和贡献明细。</p>
        </div>
        <span>{scores.length} 条</span>
      </header>
      {sorted.map((entry) => (
        <details key={`${entry.candidateId}:${entry.materialId}`} className="catalog-material-score-entry">
          <summary>
            <span>
              <strong>{entry.candidateName}</strong>
              <small>
                {materialTypeLabels[entry.materialType]} · {entry.year ?? "年份待核实"} ·{" "}
                {entry.materialTitle}
              </small>
            </span>
            <span className="catalog-material-score-value">
              {formatPoints(entry.materialScore)}
              <small>
                {Math.round(entry.scoreCoverage * 100)}% 覆盖{entry.provisional ? " · 暂定" : ""}
              </small>
            </span>
          </summary>
          <div className="catalog-material-score-body">
            <blockquote>{entry.resumeClaim}</blockquote>
            <button
              className="catalog-material-evidence"
              onClick={() => onSelectEvidence(entry.candidateId, entry.resumeClaim)}
            >
              打开简历并定位原文
            </button>
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
            <small className="catalog-material-score-time">
              {entry.scoringVersion} · {new Date(entry.evaluatedAt).toLocaleString("zh-CN")}
            </small>
          </div>
        </details>
      ))}
    </section>
  );
}
