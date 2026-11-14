import { useRef } from "react";
import { ArrowUpFromLine, BriefcaseBusiness, FileText, FolderOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import "./empty-resume-workspace.css";

type Props = {
  loading: boolean;
  loadError: boolean;
  importing: boolean;
  progress: string;
  error: string;
  onImport: (files: FileList | null) => Promise<void>;
  onRefresh: () => void;
  onOpenFolder: () => void;
};

export default function EmptyResumeWorkspace({ loading, loadError, importing, progress, error, onImport, onRefresh, onOpenFolder }: Props) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement | null>(null);
  const waiting = loading || importing;
  const heading = importing ? "正在导入简历" : loading ? "正在读取本地简历库" : loadError ? "暂时无法读取简历库" : "导入第一份简历，开始分析";

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Bohack 简历工作台首页"><span className="brand-mark"><BriefcaseBusiness size={17} /></span><span>bohack<span className="brand-dot">.</span></span></a>
      <div className="topbar-divider" />
      <div className="workspace-name">招聘工作台</div>
      <div className="topbar-spacer" />
      <div className="privacy-note"><ShieldCheck size={15} />本地存储</div>
    </header>
    <main className="empty-resume-workspace">
      <section className="empty-resume-card" aria-labelledby="empty-resume-heading">
        <div className="empty-resume-icon">{waiting ? <LoaderCircle size={30} className="spin" /> : <FileText size={30} />}</div>
        <span className="eyebrow">BOHACK / RESUME WORKSPACE</span>
        <h1 id="empty-resume-heading">{heading}</h1>
        {waiting ? <p role="status">{importing ? `正在处理 ${progress || "所选 PDF"}，完成后会自动打开候选人。` : "正在加载候选人，请稍候。"}</p>
          : <p>当前没有可展示的候选人。选择 PDF 或整个文件夹，导入后即可阅读原文、分析材料并查看评分依据。</p>}
        {error && <div className="empty-resume-error" role="alert">{error}</div>}
        <div className="empty-resume-actions">
          <button type="button" className="empty-resume-primary" disabled={waiting} onClick={() => files.current?.click()}><ArrowUpFromLine size={16} />导入 PDF 简历</button>
          <button type="button" className="empty-resume-secondary" disabled={waiting} onClick={() => folder.current?.click()}><FolderOpen size={16} />导入文件夹</button>
        </div>
        <input ref={files} className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple onChange={async (event) => { const input = event.currentTarget; await onImport(input.files); input.value = ""; }} />
        <input ref={(element) => { folder.current = element; element?.setAttribute("webkitdirectory", ""); }} className="visually-hidden" type="file" multiple onChange={async (event) => { const input = event.currentTarget; await onImport(input.files); input.value = ""; }} />
        <div className="empty-resume-links">
          <button type="button" disabled={waiting} onClick={onRefresh}>重新读取简历库</button>
          <span aria-hidden="true">·</span>
          <button type="button" disabled={waiting} onClick={onOpenFolder}>打开存储位置</button>
        </div>
        <div className="empty-resume-details"><span><ShieldCheck size={15} />原始 PDF 和候选人资料保存在本机</span><span>支持单份或批量 PDF · 扫描件可在导入后补充 OCR 文本</span></div>
      </section>
    </main>
  </div>;
}
