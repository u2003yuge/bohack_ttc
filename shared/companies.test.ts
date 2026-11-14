import assert from "node:assert/strict";
import test from "node:test";
import { companyCatalog } from "./companies.js";
import { knowledgeRecords, normalizeKnowledgeImport } from "./knowledge.js";

test("company catalog is merged into the company library with full source profiles", () => {
  const companies = knowledgeRecords.filter((record) => record.kind === "company");
  assert.equal(companyCatalog.length, 100);
  assert.equal(new Set(companyCatalog.map((record) => record.name.normalize("NFKC").toLowerCase())).size, 100);
  assert.equal(companies.length, 104);

  const alibaba = companies.find((record) => record.id === "company-alibaba");
  assert.equal(alibaba?.title, "阿里巴巴集团");
  assert.ok(alibaba?.aliases.includes("阿里巴巴"));
  assert.equal(alibaba?.company?.englishName, "Alibaba Group");
  assert.equal(alibaba?.company?.businessScope, "电商平台、云计算、物流、数字媒体和本地生活");
  assert.equal(alibaba?.company?.source.url, alibaba?.officialUrl);
  assert.equal(alibaba?.evidenceSources?.[0].verified, false);

  const netflix = companies.find((record) => record.title === "奈飞");
  assert.ok(netflix?.company?.foundedYear);
  assert.ok(netflix?.company?.info.length);
  assert.equal(companies.filter((record) => record.company).length, 100);
});

test("company profiles survive knowledge backup normalization", () => {
  const input = {
    format: "bohack-knowledge-library",
    version: 1,
    records: [{
      id: "custom-company-profile-1", kind: "company", title: "示例公司", significanceScore: 50,
      company: { englishName: "Example", countryRegion: "中国", industry: "软件", foundedYear: 2001,
        headquarters: "杭州", info: "背景", shortInfo: "简介", influence: "影响", businessScope: "软件服务",
        representativeProducts: "产品 A", publicSignals: ["官网介绍"], notes: "需复核",
        source: { title: "官方介绍", url: "https://example.com/about", sourceType: "official_website", accessedAt: "2026-11-14" } },
    }],
  };
  const result = normalizeKnowledgeImport(input);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.records[0].company?.englishName, "Example");
  assert.equal(result.records[0].company?.source.url, "https://example.com/about");
});
