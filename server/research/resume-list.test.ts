import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

function textPdf(): Buffer {
  const content = "BT /F1 12 Tf 50 750 Td (Offline resume) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return Buffer.from(pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test("startup lists 160 legacy PDFs without re-parsing, model calls or overwriting reports; newly found PDFs index offline", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bohack-resume-list-"));
  let modelCalls = 0;
  const model = createServer((_request, response) => {
    modelCalls++;
    response.writeHead(500).end("Listing must not call the model");
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const modelAddress = model.address();
  assert.ok(modelAddress && typeof modelAddress !== "string");
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  await mkdir(path.join(directory, ".metadata"));
  const originals = new Map<string, string>();
  await Promise.all(Array.from({ length: 160 }, async (_, index) => {
    const id = String(index + 1);
    const record = {
      id, fileName: `${id}.pdf`, name: `Legacy ${id}`, source: "pdf", text: "Saved resume text",
      role: "Developer", received: "2026-01-01", initials: "L", education: "", skills: [],
      extractionVersion: 1, analysisReport: `Keep report ${id}`, analysisStatus: "complete",
      assessment: index % 3 === 0 ? undefined : {
        version: index % 3 === 1 ? "old-version" : "v1",
        abilities: { professional_execution: { score: null } },
      },
      assessmentHistory: [{ reason: "review", note: "Keep saved history" }],
    };
    const raw = JSON.stringify(record);
    originals.set(id, raw);
    // Intentionally invalid PDF bytes prove that cached records are not re-parsed.
    await writeFile(path.join(directory, `${id}.pdf`), "Cached PDF must not be opened by listing");
    await writeFile(path.join(directory, ".metadata", `${id}.json`), raw);
  }));
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, PORT: String(address.port), RESUME_DIR: directory,
      OPENAI_API_KEY: "test-key-not-used", OPENAI_BASE_URL: `http://127.0.0.1:${modelAddress.port}/v1`,
      OPENAI_MODEL: "test", TAVILY_API_KEY: "", KNOWLEDGE_DB_DIR: path.join(directory, "library"), REPORT_DIR: path.join(directory, "reports") },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(stderr || "API startup timeout")), 10000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("Agent API listening")) { clearTimeout(timer); resolve(); } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(stderr || "API exited")); });
    });
    const endpoint = `http://127.0.0.1:${address.port}/api/resumes`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.resumes.length, 160);
    assert.equal(modelCalls, 0);
    for (const record of payload.resumes) assert.deepEqual(record, JSON.parse(originals.get(record.id)!));
    await writeFile(path.join(directory, "new-offline.pdf"), textPdf());
    const discovered = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    assert.equal(discovered.status, 200);
    const records = (await discovered.json()).resumes;
    assert.equal(records.length, 161);
    const fresh = records.find((record: { id: string }) => record.id === "new-offline");
    assert.equal(fresh.text, "Offline resume");
    assert.equal(fresh.analysisStatus, "unavailable");
    assert.equal(fresh.analysisReport, "");
    assert.equal(fresh.assessment, undefined);
    assert.deepEqual(fresh.agentArtifacts, []);
    assert.match(fresh.analysisError, /尚未运行 AI 分析/);
    assert.equal(modelCalls, 0);
    for (const [id, raw] of originals) {
      assert.equal(await readFile(path.join(directory, ".metadata", `${id}.json`), "utf8"), raw);
    }
    assert.equal((await fetch(endpoint, { signal: AbortSignal.timeout(5000) })).status, 200);
    assert.equal(modelCalls, 0);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill(); await exited;
    }
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
