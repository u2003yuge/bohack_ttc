import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import reviews from "../db/competition-logo-review.json" with { type: "json" };
import { competitionLogoAsset, competitionLogoAssets } from "./competition-assets.js";
import { competitionCatalog } from "./competitions.js";
import { knowledgeRecords } from "./knowledge.js";

test("competition images bind to all 118 catalog identities and exact reviewed source hashes", () => {
  assert.deepEqual(Object.keys(competitionLogoAssets).sort(), competitionCatalog.map((profile) => profile.id).sort());
  const decisions = reviews.entries as Record<string, {
    id: string; name: string; officialWebsite: string | null; file: string; source_url: string;
    decision: string; sourceSha256?: string; displayKind: string | null;
  }>;
  const counts: Record<string, number> = {};
  for (const profile of competitionCatalog) {
    const asset = competitionLogoAsset(profile)!;
    const review = decisions[profile.id];
    assert.ok(asset);
    assert.equal(review.id, profile.id);
    assert.equal(review.name, profile.name);
    assert.equal(review.officialWebsite, profile.official_website);
    assert.equal(asset.sourcePath, review.file ? `competitions_logo/${review.file}` : null);
    assert.equal(asset.sourceUrl, review.source_url || null);
    assert.equal(asset.sourceSha256, review.sourceSha256);
    assert.equal(asset.displayKind, review.displayKind);
    counts[asset.status] = (counts[asset.status] ?? 0) + 1;
    if (asset.status === "ready") {
      assert.equal(review.decision, "accept");
      assert.ok(asset.displayKind);
      const extension = asset.detectedFormat === "SVG" ? "svg" : "png";
      assert.equal(asset.displayPath, `/competitions_logo/${profile.id}.${extension}`);
      const bytes = readFileSync(new URL("../public" + asset.displayPath, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.displaySha256);
      if (extension === "png") {
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.equal(bytes.readUInt32BE(16), asset.width);
        assert.equal(bytes.readUInt32BE(20), asset.height);
        assert.ok(asset.width! <= 256 && asset.height! <= 256);
      } else {
        assert.match(bytes.toString(), /^<svg /);
        assert.doesNotMatch(bytes.toString(), /<script|<foreignObject|<!DOCTYPE|<!ENTITY|onload=|href="(?:https?:|data:|file:)/i);
      }
    } else {
      assert.equal(asset.displayPath, null);
    }
  }
  assert.deepEqual(counts, { ready: 76, not_found: 25, rejected: 17 });
  assert.equal(readdirSync(new URL("../public/competitions_logo/", import.meta.url)).length, 76);
});

test("logos resolve through original profile identities even after seed records are merged", () => {
  const blueBridge = knowledgeRecords.find((record) => record.id === "competition-blue-bridge")!;
  assert.equal(blueBridge.competition!.id, "2024-27");
  assert.equal(competitionLogoAsset(blueBridge.competition)!.displayPath, "/competitions_logo/2024-27.png");
  const profile = blueBridge.competition!;
  assert.equal(competitionLogoAsset(undefined), undefined);
  assert.equal(competitionLogoAsset({ ...profile, id: "competition-blue-bridge" }), undefined);
  assert.equal(competitionLogoAsset({ ...profile, name: "蓝桥杯（另一个赛事）" }), undefined);
  assert.equal(competitionLogoAsset({ ...profile, official_website: "https://unrelated.example/" }), undefined);
  assert.equal(competitionLogoAsset({ ...profile, report_year: 2023 }), undefined);
  assert.equal(competitionLogoAsset(competitionCatalog.find((item) => item.id === "2024-04"))!.status, "not_found");
});

test("wrong emblems, placeholders and photos are excluded; shared source icons never merge distinct events", () => {
  for (const id of ["2023-10", "2023-17", "2024-02", "2024-23", "2024-33", "2024-52", "2024-66", "2024-75"]) {
    assert.equal(competitionLogoAssets[id].status, "rejected");
    assert.equal(competitionLogoAssets[id].displayPath, null);
    assert.ok(!readdirSync(new URL("../public/competitions_logo/", import.meta.url)).some((file) => file.startsWith(id + ".")));
  }
  for (const [first, second, kind] of [
    ["2023-21", "2024-14", "organization_icon"],
    ["2024-09", "2024-26", "platform_icon"],
    ["2024-81", "2024-82", "organization_icon"],
  ]) {
    assert.equal(competitionLogoAssets[first].sourceSha256, competitionLogoAssets[second].sourceSha256);
    assert.equal(competitionLogoAssets[first].displayKind, kind);
    assert.equal(competitionLogoAssets[second].displayKind, kind);
    const a = knowledgeRecords.find((record) => record.competition?.id === first)!;
    const b = knowledgeRecords.find((record) => record.competition?.id === second)!;
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.title, b.title);
    assert.equal(a.verificationStatus, "示例资料，待核验");
    assert.equal(b.verificationStatus, "示例资料，待核验");
  }
});
