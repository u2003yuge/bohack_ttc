import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { venueLogoAsset, venueLogoAssets } from "./venue-assets.js";
import { normalizeVenueProfile } from "./venue-profile.js";
import { venueCatalog } from "./venues.js";
import { findVenueBackground, knowledgeRecords, normalizeKnowledgeImport } from "./knowledge.js";

test("every catalog logo has an import result; only decoded and hashed local PNGs are served", () => {
  assert.deepEqual(Object.keys(venueLogoAssets).sort(), venueCatalog.map((venue) => venue.id).sort());
  let ready = 0, invalid = 0, notFound = 0;
  for (const venue of venueCatalog) {
    const asset = venueLogoAsset(venue)!;
    assert.ok(asset);
    assert.equal(asset.sourcePath, venue.logo!.path);
    if (asset.status === "ready") {
      ready++;
      assert.equal(asset.displayPath, "/papers_logo/" + venue.id + ".png");
      const bytes = readFileSync(new URL("../public" + asset.displayPath, import.meta.url));
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.displaySha256);
      assert.equal(bytes.readUInt32BE(16), asset.width);
      assert.equal(bytes.readUInt32BE(20), asset.height);
      assert.ok(asset.width! <= 256 && asset.height! <= 256);
    } else {
      assert.equal(asset.displayPath, null);
      if (asset.status === "invalid") invalid++;
      if (asset.status === "not_found") notFound++;
    }
  }
  assert.deepEqual({ ready, invalid, notFound }, { ready: 55, invalid: 10, notFound: 35 });
  assert.equal(readdirSync(new URL("../public/papers_logo/", import.meta.url)).length, ready);
  const first = venueCatalog[0];
  assert.equal(venueLogoAsset({ ...first, logo: { ...first.logo!, path: "papers_logo/other.png" } }), undefined);
});

test("yearly metrics and logo metadata survive backups and are available to analysis without verifying personal achievements", () => {
  const record = knowledgeRecords.find((entry) => entry.venue?.id === "journal-tpami")!;
  assert.ok(record.evidenceSources!.some((source) => source.url === record.venue!.impact_factor!.sources[0].url));
  const bundle = normalizeKnowledgeImport({ format: "bohack-knowledge-library", version: 1,
    records: [{ ...record, id: "custom-venue-metrics" }] });
  assert.ok(!("error" in bundle));
  if ("error" in bundle) return;
  assert.deepEqual(bundle.records[0].venue, record.venue);
  assert.equal(bundle.records[0].verificationStatus, record.verificationStatus);
  const background = findVenueBackground("论文发表于 TPAMI")[0];
  assert.deepEqual(background.impact_factor, record.venue!.impact_factor);
  assert.equal(venueCatalog.find((venue) => venue.id === "journal-jmlr")!.impact_factor!.years["2025"], null);
  assert.ok(venueCatalog.filter((venue) => venue.type === "会议").every((venue) => venue.impact_factor!.status === "not_applicable"
    && Object.values(venue.impact_factor!.years).every((value) => value === null)));
});

test("extended venue validation rejects unsafe paths, metric URLs and fabricated numerical states while accepting old profiles", () => {
  const venue = venueCatalog.find((item) => item.id === "journal-tpami")!;
  const impact = venue.impact_factor!;
  const logo = venue.logo!;
  const invalid = [
    { ...venue, logo: { ...logo, path: "papers_logo/../../.env" } },
    { ...venue, logo: { ...logo, path: "https://evil.example/image.png" } },
    { ...venue, logo: { ...logo, source_url: "javascript:alert(1)" } },
    { ...venue, logo: { ...logo, format: "html" } },
    { ...venue, impact_factor: { ...impact, sources: [{ ...impact.sources[0], url: "file:///private" }] } },
    { ...venue, impact_factor: { ...impact, years: { "2025": -1 } } },
    { ...venue, impact_factor: { ...impact, years: { "2025": "20.4" } } },
    { ...venue, impact_factor: { ...impact, years: { "2025": Infinity } } },
    { ...venue, impact_factor: { ...impact, sources: [] } },
    { ...venue, impact_factor: { ...impact, status: "not_found" } },
    { ...venue, type: "会议" },
  ];
  for (const input of invalid) assert.equal(normalizeVenueProfile(input), undefined);
  const { logo: _logo, impact_factor: _impact, ...legacy } = venue;
  assert.deepEqual(normalizeVenueProfile(legacy), legacy);
  const zero = normalizeVenueProfile({ ...venue, impact_factor: { ...impact, years: { "2025": 0 } } });
  assert.equal(zero?.impact_factor?.years["2025"], 0);
});
