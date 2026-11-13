import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import OpenAI from "openai";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type ResumeRecord = {
  id: string;
  fileName: string;
  name: string;
  role: string;
  location: string;
  received: string;
  initials: string;
  source: "pdf";
  text: string;
  education: string;
  skills: string[];
  summary: string;
  pages: number;
  size: number;
};

const directory = path.resolve(process.env.RESUME_DIR || ".data/resumes");
const router = Router();
const maxPdfSize = 30 * 1024 * 1024;

router.use(async (_request, _response, next) => {
  try {
    await mkdir(directory, { recursive: true });
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/", async (_request, response, next) => {
  try {
    const records = await readDirectory();
    response.json({ directory, resumes: records });
  } catch (error) {
    next(error);
  }
});

router.post("/scan", async (_request, response, next) => {
  try {
    const names = await readdir(directory);
    const records: ResumeRecord[] = [];
    for (const name of names.filter((value) => value.toLowerCase().endsWith(".pdf"))) {
      const filePath = path.join(directory, name);
      const id = path.basename(name, path.extname(name));
      const existing = await readRecord(id);
      if (existing) {
        records.push(existing);
        continue;
      }
      const record = await indexPdf(filePath, id, name);
      await writeRecord(record);
      records.push(record);
    }
    response.json({ directory, resumes: records.sort(sortRecords) });
  } catch (error) {
    next(error);
  }
});

router.post("/open-folder", (_request, response) => {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [directory], { detached: true, stdio: "ignore" });
  child.once("error", () => response.status(500).json({ error: "无法打开简历文件夹。" }));
  child.once("spawn", () => {
    child.unref();
    response.json({ opened: true });
  });
});

router.post("/", async (request, response, next) => {
  try {
    const buffer = request.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      response.status(400).json({ error: "请选择要导入的 PDF 文件。" });
      return;
    }
    if (buffer.length > maxPdfSize) {
      response.status(413).json({ error: "PDF 文件不能超过 30 MB。" });
      return;
    }
    if (buffer.subarray(0, 5).toString() !== "%PDF-") {
      response.status(415).json({ error: "文件内容不是有效的 PDF。" });
      return;
    }

    const suppliedName = decodeURIComponent(String(request.header("x-file-name") || "resume.pdf"));
    const originalName = path.basename(suppliedName).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    const stem = path.basename(originalName, path.extname(originalName)).trim() || "resume";
    const id = `${stem.slice(0, 80)}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const fileName = `${id}.pdf`;
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, buffer, { flag: "wx" });

    try {
      const record = await indexPdf(filePath, id, fileName);
      await writeRecord(record);
      response.status(201).json(record);
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

router.get("/:id/file", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) {
      response.status(404).json({ error: "找不到这份简历。" });
      return;
    }
    response.type("application/pdf");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.fileName)}`);
    response.sendFile(path.join(directory, record.fileName));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (request, response, next) => {
  try {
    const record = await readRecord(request.params.id);
    if (!record) {
      response.status(404).json({ error: "找不到这份简历。" });
      return;
    }
    await Promise.all([
      rm(path.join(directory, record.fileName), { force: true }),
      rm(metadataPath(record.id), { force: true }),
    ]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

async function readDirectory(): Promise<ResumeRecord[]> {
  const names = await readdir(directory);
  const pdfNames = names.filter((name) => name.toLowerCase().endsWith(".pdf"));
  const records: ResumeRecord[] = [];
  for (let offset = 0; offset < pdfNames.length; offset += 3) {
    const batch = await Promise.all(pdfNames.slice(offset, offset + 3).map(async (name) => {
      const id = path.basename(name, path.extname(name));
      const existing = await readRecord(id);
      if (existing) return existing;
      const record = await indexPdf(path.join(directory, name), id, name);
      await writeRecord(record);
      return record;
    }));
    records.push(...batch);
  }
  return records.sort(sortRecords);
}

async function indexPdf(filePath: string, id: string, fileName: string): Promise<ResumeRecord> {
  const buffer = await readFile(filePath);
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    page.cleanup();
  }
  await pdf.destroy();
  const text = pages.join("\n\n").trim();
  const ai = await extractCandidate(text, fileName);
  const fallbackName = path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, " ").trim();
  const name = ai?.name?.trim() || fallbackName || "未命名候选人";
  const fileStats = await stat(filePath);
  return {
    id,
    fileName,
    name,
    role: ai?.role?.trim() || "待提取岗位",
    location: ai?.location?.trim() || "未识别地点",
    received: new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(fileStats.mtime),
    initials: name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    source: "pdf",
    text,
    education: ai?.education?.trim() || "待确认",
    skills: Array.isArray(ai?.skills) ? ai.skills.filter((value): value is string => typeof value === "string").slice(0, 10) : [],
    summary: ai?.summary?.trim() || "",
    pages: pages.length,
    size: fileStats.size,
  };
}

async function extractCandidate(text: string, fileName: string): Promise<Partial<Pick<ResumeRecord, "name" | "role" | "location" | "education" | "skills" | "summary">> | null> {
  if (!process.env.OPENAI_API_KEY || !text) return null;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 45000 });
  try {
    const result = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0,
      messages: [
        { role: "system", content: "你是简历信息提取器。只提取原文明确出现的信息，不推断敏感属性。仅返回合法 JSON，字段为 name、role、location、education、skills（字符串数组）、summary（不超过 80 字）。未知的字符串字段填空字符串，skills 没有证据则返回空数组。" },
        { role: "user", content: `文件名：${fileName}\n简历原文：\n${text.slice(0, 18000)}` },
      ],
    });
    const content = result.choices[0]?.message?.content ?? "";
    const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
    if (!json.startsWith("{") || !json.endsWith("}")) return null;
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      role: typeof parsed.role === "string" ? parsed.role : "",
      location: typeof parsed.location === "string" ? parsed.location : "",
      education: typeof parsed.education === "string" ? parsed.education : "",
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter((value): value is string => typeof value === "string") : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  } catch {
    return null;
  }
}

async function writeRecord(record: ResumeRecord): Promise<void> {
  await mkdir(path.join(directory, ".metadata"), { recursive: true });
  await writeFile(metadataPath(record.id), JSON.stringify(record, null, 2), "utf8");
}

async function readRecord(id: string): Promise<ResumeRecord | null> {
  try {
    return JSON.parse(await readFile(metadataPath(id), "utf8")) as ResumeRecord;
  } catch {
    return null;
  }
}

function metadataPath(id: string): string {
  return path.join(directory, ".metadata", `${path.basename(id)}.json`);
}

function sortRecords(a: ResumeRecord, b: ResumeRecord): number {
  return b.received.localeCompare(a.received, "zh-CN");
}

export default router;
