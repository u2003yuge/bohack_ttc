import { useEffect, useMemo, useRef, useState } from "react";
import {
  abilityDimensions,
  actionLevels,
  calibrationStatus,
  factorDefinitions,
  jobPresets,
  materialTypeLabels,
  normalizeJobPreference,
  presetPreference,
  rankAssessment,
  scoringVersion,
  typeAdaptation,
  type Assessment,
  type JobPreference,
} from "../shared/material-scoring";
import type { Resume } from "./types";
import type { AnalysisEvent, AnalysisProgress, AnalysisResult } from "./research-types";
import { readAnalysisEvents } from "./analysis-stream";
import MaterialAssessment, { formatPoints } from "./MaterialAssessment";
import "./material-scoring.css";

type Props = {
  resumes: Resume[];
  selected: Resume;
  onSelect: (id: string) => void;
  onUpdate: (resume: Resume) => void;
  onEvidence: (quote: string) => void;
  onRead: () => void;
  agentAvailable: boolean;
  initialTab?: "candidate" | "comparison" | "rules";
};
const statusLabels = {
  ready: "可比较",
  provisional: "暂定分",
  pending: "待核实",
  excluded: "有证据不符合",
  conflict: "来源冲突",
};
export default function ScoringWorkspace({
  resumes,
  selected,
  onSelect,
  onUpdate,
  onEvidence,
  onRead,
  agentAvailable,
  initialTab = "candidate",
}: Props) {
  const [tab, setTab] = useState<"candidate" | "comparison" | "rules">(initialTab);
  const [includeResearch, setIncludeResearch] = useState(true);
  const [useModel, setUseModel] = useState(true);
  const [ocrText, setOcrText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const run = useRef(0);
  const [job, setJob] = useState<JobPreference>({ ...presetPreference(), title: "" });
  const [weightInputs, setWeightInputs] = useState(() =>
    Object.fromEntries(abilityDimensions.map(({ key }) => [key, "20"])),
  );
  const [jobs, setJobs] = useState<JobPreference[]>([]);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<JobPreference | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [jobMessage, setJobMessage] = useState("");
  const [conditionText, setConditionText] = useState("");
  const [rankingFilter, setRankingFilter] = useState<"all" | "ranked" | "pending">("all");
  const draftController = useRef<AbortController | null>(null);
  const draftRun = useRef(0);
  useEffect(() => {
    run.current += 1;
    controller.current?.abort();
    setBusy(false);
    setOcrText("");
    setProgress(null);
    setError("");
    return () => controller.current?.abort();
  }, [selected.id]);
  useEffect(() => {
    fetch("/api/scoring/jobs")
      .then((response) => {
        if (!response.ok) throw new Error("岗位配置读取失败。");
        return response.json();
      })
      .then((result) => setJobs(result.jobs ?? []))
      .catch((e) => setJobMessage(String(e)));
    return () => draftController.current?.abort();
  }, []);
  const rows = useMemo(
    () =>
      resumes
        .map((resume) => ({ resume, ranking: rankAssessment(resume.assessment, job, resume.text) }))
        .sort((a, b) =>
          a.ranking.score === null
            ? b.ranking.score === null
              ? a.resume.name.localeCompare(b.resume.name)
              : 1
            : b.ranking.score === null
              ? -1
              : b.ranking.score - a.ranking.score || a.resume.name.localeCompare(b.resume.name),
        ),
    [resumes, job],
  );
  const nextRows = useMemo(
    () =>
      draft
        ? resumes
            .map((resume) => ({
              id: resume.id,
              score: rankAssessment(resume.assessment, draft, resume.text).score,
            }))
            .filter((r) => r.score !== null)
            .sort((a, b) => b.score! - a.score!)
        : [],
    [draft, resumes],
  );
  const currentRanked = rows.filter((r) => r.ranking.score !== null);
  async function evaluate(candidates: Resume[]) {
    const id = ++run.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    const failures: string[] = [];
    try {
      for (let index = 0; index < candidates.length; index += 1) {
        abort.signal.throwIfAborted();
        const candidate = candidates[index];
        try {
          setProgress({
            stage: "extracting",
            message: `正在评估 ${candidate.name} · ${index + 1}/${candidates.length}`,
          });
          const text = candidates.length === 1 && ocrText.trim() ? ocrText : candidate.text;
          const endpoint =
            candidate.source === "pdf"
              ? `/api/resumes/${encodeURIComponent(candidate.id)}/assessment`
              : "/api/scoring/evaluate";
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abort.signal,
            body: JSON.stringify({
              text,
              ocrText: candidates.length === 1 ? ocrText : "",
              includeResearch: includeResearch && candidate.source !== "demo",
              useModel: useModel && agentAvailable,
              streamProgress: true,
            }),
          });
          const apply = (result: AnalysisResult) => {
            if (id !== run.current || !result.assessment) return;
            const assessment = result.assessment;
            onUpdate(
              result.resume ?? {
                ...candidate,
                assessment,
                assessmentHistory: [...(candidate.assessmentHistory ?? []), { reason: "review", assessment }],
                analysisReport: result.answer,
              },
            );
          };
          if (!response.ok || !response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "材料评估失败。");
            apply(result);
          } else
            await readAnalysisEvents(response, (event: AnalysisEvent) => {
              if (id !== run.current) return;
              if (event.type === "progress")
                setProgress({ ...event.progress, message: `${candidate.name} · ${event.progress.message}` });
              if (event.type === "complete") apply(event);
            });
        } catch (cause) {
          if (abort.signal.aborted) throw cause;
          failures.push(`${candidate.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
      if (failures.length && id === run.current) setError(failures.join("\n"));
    } catch (e) {
      if (id === run.current)
        setError(
          abort.signal.aborted
            ? "评估已停止，已完成的档案已保留。"
            : e instanceof Error
              ? e.message
              : "评估失败。",
        );
    } finally {
      if (id === run.current) {
        setBusy(false);
        setProgress(null);
      }
      if (controller.current === abort) controller.current = null;
    }
  }
  const stop = () => {
    controller.current?.abort();
  };
  const changeJob = (next: JobPreference) => {
    draftRun.current += 1;
    draftController.current?.abort();
    setDraftBusy(false);
    setJob(next);
    setWeightInputs(
      Object.fromEntries(
        abilityDimensions.map(({ key }) => [key, String(Math.round(next.weights[key] * 10000) / 100)]),
      ),
    );
    setDraft(null);
    setJobMessage("");
    setConditionText(next.must_have.join("\n"));
  };
  async function suggest() {
    const id = ++draftRun.current;
    draftController.current?.abort();
    const abort = new AbortController();
    draftController.current = abort;
    setDraftBusy(true);
    setDraft(null);
    setJobMessage("");
    try {
      const response = await fetch("/api/scoring/preferences/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({ instruction, current: job }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "偏好整理失败。");
      if (id === draftRun.current) {
        setDraft(result.preference);
        setJobMessage(result.note ?? "");
      }
    } catch (e) {
      if (!abort.signal.aborted && id === draftRun.current)
        setJobMessage(e instanceof Error ? e.message : "偏好整理失败。");
    } finally {
      if (id === draftRun.current) setDraftBusy(false);
    }
  }
  async function saveJob() {
    try {
      const response = await fetch("/api/scoring/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "岗位保存失败。");
      setJobs(result.jobs);
      setJobMessage("岗位配置已保存，候选人的材料分和能力分保持独立。");
    } catch (e) {
      setJobMessage(e instanceof Error ? e.message : "岗位保存失败。");
    }
  }
  function downloadAssessment(assessment: Assessment) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(assessment, null, 2)], { type: "application/json;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selected.id}-${assessment.version}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const extractionHint =
    selected.source === "demo"
      ? "合成演示按原文评估，不检索虚构背景"
      : agentAvailable
        ? "AI 只提取事实，分数由规则计算"
        : "当前使用规则抽取，无需模型配置";
  return (
    <main className="scoring-workspace">
      <header className="ms-workspace-heading">
        <div>
          <span className="ms-eyebrow">BOHACK / MATERIAL SCORING</span>
          <h1>让每一分都有材料依据</h1>
          <p>先理解经历，再评估材料与个人行动，最后按岗位偏好比较。</p>
        </div>
        <span className="ms-version">{scoringVersion}</span>
      </header>
      <nav className="ms-tabs" aria-label="材料评分视图">
        {(
          [
            ["candidate", "单人材料与能力"],
            ["comparison", "岗位排序与对比"],
            ["rules", "规则与参数"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="ms-controls">
        <label>
          <input
            type="checkbox"
            checked={includeResearch}
            disabled={busy}
            onChange={(e) => setIncludeResearch(e.target.checked)}
          />
          查询竞赛、论文和项目背景
        </label>
        <label>
          <input
            type="checkbox"
            checked={useModel && agentAvailable}
            disabled={busy || !agentAvailable}
            onChange={(e) => setUseModel(e.target.checked)}
          />
          AI 提取材料
        </label>
        <span>{extractionHint}</span>
        <button
          className="ms-primary"
          disabled={busy || (!selected.text.trim() && !ocrText.trim())}
          onClick={() => evaluate([selected])}
        >
          {busy ? "正在评估…" : selected.assessment ? "重新评估当前简历" : "评估当前简历"}
        </button>
        {busy && (
          <button className="ms-secondary" onClick={stop}>
            停止
          </button>
        )}
      </div>
      {progress && (
        <div className="ms-progress" role="status">
          <span className="ms-loading" />
          {progress.message}
          {progress.total ? <progress max={progress.total} value={progress.completed ?? 0} /> : null}
        </div>
      )}
      {error && (
        <div className="ms-error" role="alert">
          {error}
        </div>
      )}
      {tab === "candidate" && (
        <>
          <div className="ms-candidate-heading">
            <div>
              <h2>
                {selected.name}{" "}
                <span className="ms-badge">{selected.source === "demo" ? "合成演示" : "本地 PDF"}</span>
              </h2>
              <p>
                {selected.role} · {selected.location}
              </p>
            </div>
            <div>
              <button className="ms-secondary" onClick={onRead}>
                阅读原文与分析报告
              </button>
              {selected.assessment && (
                <button className="ms-secondary" onClick={() => downloadAssessment(selected.assessment!)}>
                  导出评分 JSON
                </button>
              )}
            </div>
          </div>
          <details className="ms-ocr">
            <summary>补充本次分析的 OCR 文本</summary>
            <textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              disabled={busy}
              maxLength={100000}
              placeholder="扫描件可粘贴外部 OCR 结果。本次评估使用这些文本，保留原始 PDF。"
            />
          </details>
          {selected.assessment ? (
            <MaterialAssessment
              key={selected.id}
              assessment={selected.assessment}
              history={selected.assessmentHistory}
              onEvidence={onEvidence}
            />
          ) : (
            <div className="ms-empty ms-empty-large">
              <h2>先整理材料，再计算能力</h2>
              <p>点击“评估当前简历”生成七类材料、五维能力及逐项评分依据。旧版六维分数会保留为历史资料。</p>
              <button className="ms-primary" disabled={busy} onClick={() => evaluate([selected])}>
                开始材料评估
              </button>
            </div>
          )}
        </>
      )}
      {tab === "comparison" && (
        <>
          <section className="ms-job">
            <div className="ms-section-heading">
              <div>
                <h2>当前岗位偏好</h2>
                <p>同一岗位、权重、规则版本和递减参数下比较。改偏好无需重新评估简历。</p>
              </div>
              <button className="ms-secondary" onClick={saveJob} disabled={!job.title}>
                保存岗位配置
              </button>
            </div>
            <div className="ms-job-fields">
              <label>
                岗位名称
                <input
                  value={job.title}
                  onChange={(e) => changeJob({ ...job, title: e.target.value })}
                  placeholder="填写岗位名称后生成可比排序分"
                />
              </label>
              <label>
                载入配置
                <select
                  value=""
                  onChange={(e) => {
                    const preset = jobPresets.find((p) => p.key === e.target.value);
                    const saved = jobs.find((j) => `saved:${j.title}` === e.target.value);
                    if (preset) changeJob(presetPreference(preset));
                    else if (saved) changeJob(saved);
                  }}
                >
                  <option value="">选择预设或已保存岗位</option>
                  {jobPresets.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.title}
                    </option>
                  ))}
                  {jobs.map((j) => (
                    <option key={j.title} value={`saved:${j.title}`}>
                      已保存：{j.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ms-weight-grid">
              {abilityDimensions.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={weightInputs[key]}
                    onChange={(e) => {
                      setWeightInputs((current) => ({ ...current, [key]: e.target.value }));
                      setDraft(null);
                      draftRun.current += 1;
                      draftController.current?.abort();
                      setDraftBusy(false);
                    }}
                  />
                  <small>%</small>
                </label>
              ))}
            </div>
            <button
              className="ms-secondary"
              onClick={() => {
                try {
                  changeJob(
                    normalizeJobPreference({
                      ...job,
                      weights: Object.fromEntries(
                        abilityDimensions.map(({ key }) => [key, Number(weightInputs[key])]),
                      ),
                    }),
                  );
                } catch (e) {
                  setJobMessage(e instanceof Error ? e.message : "权重无效。");
                }
              }}
            >
              应用手动权重（归一化为 100%）
            </button>
            <label className="ms-required">
              必备条件，每行一项
              <textarea
                value={conditionText}
                onChange={(e) => {
                  setConditionText(e.target.value);
                  setDraft(null);
                }}
                onBlur={() => {
                  try {
                    changeJob(normalizeJobPreference({ ...job, must_have: conditionText.split("\n") }));
                  } catch (e) {
                    setJobMessage(e instanceof Error ? e.message : "条件无效。");
                  }
                }}
                placeholder="例如 Python。没有出现相关证据时标为待核实。"
              />
            </label>
            <div className="ms-preference-input">
              <input
                value={instruction}
                onChange={(e) => {
                  draftRun.current += 1;
                  draftController.current?.abort();
                  setDraftBusy(false);
                  setInstruction(e.target.value);
                  setDraft(null);
                }}
                maxLength={2000}
                placeholder="例如：更看重独立交付和问题解决，必须 Python"
              />
              <button className="ms-primary" onClick={suggest} disabled={draftBusy || !instruction.trim()}>
                {draftBusy ? "整理中…" : "生成偏好草案"}
              </button>
            </div>
            {jobMessage && (
              <p className="ms-job-message" role="status">
                {jobMessage}
              </p>
            )}
            {draft && (
              <div className="ms-draft">
                <h3>岗位偏好草案</h3>
                <p>{draft.rationale}</p>
                <div className="ms-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>维度</th>
                        <th>当前</th>
                        <th>草案</th>
                      </tr>
                    </thead>
                    <tbody>
                      {abilityDimensions.map(({ key, label }) => (
                        <tr key={key}>
                          <td>{label}</td>
                          <td>{formatPoints(job.weights[key] * 100)}%</td>
                          <td>{formatPoints(draft.weights[key] * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>必备条件：{draft.must_have.join("、") || "无"}</p>
                <p>
                  可排序候选人：{currentRanked.length} → {nextRows.length}
                </p>
                {rows.map(({ resume, ranking }) => {
                  const next = nextRows.find((r) => r.id === resume.id);
                  return (
                    <div className="ms-draft-impact" key={resume.id}>
                      <span>{resume.name}</span>
                      <span>
                        {formatPoints(ranking.score)} → {formatPoints(next?.score)} 分
                      </span>
                      <span>
                        名次 {currentRanked.findIndex((r) => r.resume.id === resume.id) + 1 || "待核实"} →{" "}
                        {nextRows.findIndex((r) => r.id === resume.id) + 1 || "待核实"}
                      </span>
                    </div>
                  );
                })}
                <button className="ms-primary" onClick={() => changeJob(draft)}>
                  采用草案
                </button>
                <button className="ms-secondary" onClick={() => setDraft(null)}>
                  保留当前
                </button>
              </div>
            )}
          </section>
          <section className="ms-ranking">
            <div className="ms-section-heading">
              <div>
                <h2>候选人比较</h2>
                <p>所需维度存在 NA 或必备条件待核实时，不强制生成总分。暂定分保留材料缺口。</p>
              </div>
              <button
                className="ms-secondary"
                disabled={busy || !resumes.some((r) => !r.assessment)}
                onClick={() => evaluate(resumes.filter((r) => !r.assessment))}
              >
                评估全部待评档案
              </button>
            </div>
            <div className="ms-ranking-filters">
              {(
                [
                  ["all", "全部"],
                  ["ranked", "可排序"],
                  ["pending", "待核实 / 不符合"],
                ] as const
              ).map(([key, label]) => (
                <button
                  className={rankingFilter === key ? "active" : ""}
                  key={key}
                  onClick={() => setRankingFilter(key)}
                >
                  {label}
                </button>
              ))}
              <span>
                {resumes.filter((r) => r.assessment).length} 份已评估 · 演示{" "}
                {resumes.filter((r) => r.source === "demo").length} 份
              </span>
            </div>
            <div className="ms-table-scroll">
              <table className="ms-ranking-table">
                <thead>
                  <tr>
                    <th>候选人</th>
                    <th>岗位排序分</th>
                    {abilityDimensions.map(({ key, label }) => (
                      <th key={key}>{label}</th>
                    ))}
                    <th>状态与条件</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter(
                      (r) =>
                        rankingFilter === "all" ||
                        (rankingFilter === "ranked" ? r.ranking.score !== null : r.ranking.score === null),
                    )
                    .map(({ resume, ranking }) => (
                      <tr key={resume.id} className={resume.id === selected.id ? "selected" : ""}>
                        <td>
                          <button
                            className="ms-text-button"
                            onClick={() => {
                              onSelect(resume.id);
                              setTab("candidate");
                            }}
                          >
                            {resume.name}
                          </button>
                          <small>
                            {resume.role} · {resume.source === "demo" ? "合成演示" : "PDF"}
                          </small>
                        </td>
                        <td>
                          <strong>{formatPoints(ranking.score)}</strong>
                          {ranking.score === null && resume.assessment && (
                            <small>已知贡献 {formatPoints(ranking.knownContribution)}，非可比总分</small>
                          )}
                        </td>
                        {abilityDimensions.map(({ key }) => (
                          <td key={key}>{formatPoints(resume.assessment?.abilities[key].score)}</td>
                        ))}
                        <td>
                          <span className={`ms-rank-status ${ranking.status}`}>
                            {statusLabels[ranking.status]}
                          </span>
                          {ranking.reasons.length > 0 && <small>{ranking.reasons.join(" / ")}</small>}
                          {ranking.conditions.map((condition) => (
                            <details key={condition.condition}>
                              <summary>
                                {condition.condition}：
                                {
                                  {
                                    supported: "有证据符合",
                                    contradicted: "有证据不符合",
                                    unknown: "未找到证据",
                                    conflict: "来源冲突",
                                  }[condition.status]
                                }
                              </summary>
                              {condition.evidence.map((e, i) => (
                                <p key={i}>{e}</p>
                              ))}
                            </details>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="ms-comparison-bars" aria-label="同岗位候选人分数比较">
              {currentRanked.map(({ resume, ranking }, index) => (
                <button
                  key={resume.id}
                  onClick={() => {
                    onSelect(resume.id);
                    setTab("candidate");
                  }}
                >
                  <span>
                    {index + 1}. {resume.name}
                  </span>
                  <i
                    style={{
                      width: `${(ranking.score! / Math.max(1, ...currentRanked.map((r) => r.ranking.score!))) * 65}%`,
                    }}
                  />
                  <strong>{formatPoints(ranking.score)}</strong>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      {tab === "rules" && (
        <section className="ms-rules">
          <div className="ms-section-heading">
            <div>
              <h2>算法规则与参数</h2>
              <p>{calibrationStatus}。材料因素和适配系数用于复算；岗位权重可以在岗位排序页单独调配。</p>
            </div>
            <button className="ms-secondary" type="button" onClick={() => setTab("comparison")}>调配岗位权重</button>
          </div>
          <div className="ms-rule-formulas">
            <code>M = Σ(因素权重 × 因素积分)</code>
            <code>D = M × 类型适配 R × 个人行动 A</code>
            <code>P = Σ类型 Σ排名 0.5^(排名−1) × D</code>
            <code>岗位排序分 = Σ(岗位权重 × P)</code>
          </div>
          <h3>材料因素权重与积分档位</h3>
          {Object.entries(factorDefinitions).map(([type, factors]) => (
            <details key={type}>
              <summary>
                {materialTypeLabels[type as keyof typeof materialTypeLabels]} · 权重合计{" "}
                {Math.round(factors.reduce((s, f) => s + f.weight, 0) * 100)}%
              </summary>
              <div className="ms-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>因素</th>
                      <th>权重</th>
                      <th>积分规则</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factors.map((f) => (
                      <tr key={f.key}>
                        <td>{f.label}</td>
                        <td>{Math.round(f.weight * 100)}%</td>
                        <td>
                          {f.kind === "size"
                            ? "12 × ln(1 + 有效参赛规模)"
                            : f.kind === "selectivity"
                              ? "30 × -ln(官方目标奖项比例)"
                              : f.choices.map((c) => `${c.label}=${c.points}`).join("；")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <h3>类型适配矩阵 R</h3>
          <div className="ms-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>材料类型</th>
                  {abilityDimensions.map((d) => (
                    <th key={d.key}>{d.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(typeAdaptation).map(([type, values]) => (
                  <tr key={type}>
                    <td>{materialTypeLabels[type as keyof typeof materialTypeLabels]}</td>
                    {abilityDimensions.map(({ key }) => (
                      <td key={key}>{values[key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>个人行动系数 A</h3>
          <p>
            在指导下具体执行 {actionLevels.guided}；有明确动作和对象 {actionLevels.concrete}；明确承担责任{" "}
            {actionLevels.owned}；承担责任并有交付或验证结果 {actionLevels.validated}
            。没有该维度的个人行动证据为 NA。
          </p>
          <h3>岗位预设权重</h3>
          <div className="ms-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>岗位</th>
                  {abilityDimensions.map((d) => (
                    <th key={d.key}>{d.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobPresets.map((p) => (
                  <tr key={p.key}>
                    <td>{p.title}</td>
                    {p.values.map((v, i) => (
                      <td key={i}>{v * 100}%</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            来源可信状态独立展示，不乘入分数。不同类型分别递减，因此竞赛贡献 10 与项目贡献 60 合计为
            70；同类型才会得到 65。
          </p>
        </section>
      )}
    </main>
  );
}
