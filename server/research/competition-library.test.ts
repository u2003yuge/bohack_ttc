import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { KnowledgeRecord } from "../../shared/knowledge.js";

test("catalog API loads offline, separates categories and preserves competition and venue review history", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "bohack-catalog-"));
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, PORT: String(address.port), RESUME_DIR: data, OPENAI_API_KEY: "", TAVILY_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const endpoint = `http://127.0.0.1:${address.port}/api/resumes/knowledge`;
  const json = async (suffix = "") => (await fetch(endpoint + suffix)).json();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(stderr || "API startup timeout")), 10000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("Agent API listening")) { clearTimeout(timer); resolve(); } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(stderr || "API exited")); });
    });
    const competitions = (await json("?kind=competition")).records as KnowledgeRecord[];
    assert.equal(competitions.length, 124);
    assert.equal(competitions.filter((record) => record.competition).length, 120);
    assert.ok(competitions.every((record) => record.kind === "competition"));
    const venues = (await json("?kind=journal")).records as KnowledgeRecord[];
    assert.equal(venues.length, 100);
    assert.equal(venues.filter((record) => record.venue?.type === "会议").length, 55);
    assert.equal(venues.filter((record) => record.venue?.type === "期刊").length, 45);
    assert.equal((await json()).records.length, 232);
    assert.equal((await json("?kind=company")).records.length, 8);
    assert.equal((await fetch(endpoint + "?kind=invalid")).status, 400);
    const target = competitions.find((record) => record.id === "competition-acm-icpc")!;
    const sourceId = target.evidenceSources![0].id;
    const response = await fetch(`${endpoint}/${target.id}/review`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ significanceScore: 82, scoreRationale: "保留人工评估和来源引用", evidenceSourceIds: [sourceId] }),
    });
    assert.equal(response.status, 200);
    const saved = (await json("?kind=competition")).records.find((record: KnowledgeRecord) => record.id === target.id);
    assert.equal(saved.significanceScore, 82);
    assert.deepEqual(saved.competition, target.competition);
    assert.deepEqual(saved.reviewHistory[0].evidenceSourceIds, [sourceId]);
    const disk = JSON.parse(await readFile(path.join(data, ".metadata/knowledge-reviews.json"), "utf8"));
    assert.equal(disk[target.id].significanceScore, 82);
    assert.equal((await json("/export")).reviews[target.id][0].significanceScore, 82);
    const venue = venues.find((record) => record.id === "journal-neurips")!;
    const review = await fetch(`${endpoint}/${venue.id}/review`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ significanceScore: 85, scoreRationale: "按论文年份和轨道评估", evidenceSourceIds: [venue.evidenceSources![0].id] }),
    });
    assert.equal(review.status, 200);
    const savedVenue = (await json("?kind=journal")).records.find((record: KnowledgeRecord) => record.id === venue.id);
    assert.equal(savedVenue.significanceScore, 85);
    assert.deepEqual(savedVenue.venue, venue.venue);
    const backup = await json("/export");
    assert.equal(backup.reviews[venue.id][0].significanceScore, 85);
    const restored = await fetch(`${endpoint}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backup) });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).records.length, 232);
    assert.equal((await json("?kind=company")).records.length, 8);
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await rm(data, { recursive: true, force: true });
  }
});
