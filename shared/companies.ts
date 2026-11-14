import database from "../db/companies.json" with { type: "json" };
import type { CompanyProfile, KnowledgeRecord } from "./knowledge.js";

type CompanySourceRecord = {
  id: string;
  name: string;
  english_name: string;
  country_region: string;
  industry: string;
  founded_year: number;
  headquarters: string;
  official_website: string;
  info: string;
  short_info: string;
  influence: string;
  business_scope: string;
  representative_products: string;
  public_signals: string[];
  notes: string;
  source: { title: string; url: string; source_type: string; accessed_at: string };
};

export const companyCatalog = database.records as CompanySourceRecord[];
const legacyIds: Record<string, string> = { "阿里巴巴集团": "company-alibaba" };
const plain = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

function toCompanyProfile(company: CompanySourceRecord): CompanyProfile {
  return {
    englishName: company.english_name,
    countryRegion: company.country_region,
    industry: company.industry,
    foundedYear: company.founded_year,
    headquarters: company.headquarters,
    info: company.info,
    shortInfo: company.short_info,
    influence: company.influence,
    businessScope: company.business_scope,
    representativeProducts: company.representative_products,
    publicSignals: company.public_signals,
    notes: company.notes,
    source: {
      title: company.source.title,
      url: company.source.url,
      sourceType: company.source.source_type,
      accessedAt: company.source.accessed_at,
    },
  };
}

export function mergeCompanyCatalog(seeds: KnowledgeRecord[]): KnowledgeRecord[] {
  const mergedIds = new Set<string>();
  const records = companyCatalog.map((company, index): KnowledgeRecord => {
    const terms = [company.name, company.english_name];
    const existing = seeds.find((record) => record.kind === "company" &&
      (record.id === legacyIds[company.name] || [record.title, ...record.aliases].some((term) => terms.some((candidate) => plain(term) === plain(candidate)))));
    if (existing) mergedIds.add(existing.id);
    const id = existing?.id ?? company.id ?? `company-catalog-${String(index + 1).padStart(3, "0")}`;
    const profile = toCompanyProfile(company);
    return {
      ...existing,
      id,
      kind: "company",
      title: company.name,
      aliases: [...new Set([company.english_name, ...(existing?.aliases ?? []), ...(existing && existing.title !== company.name ? [existing.title] : [])])]
        .filter((alias) => plain(alias) !== plain(company.name)),
      field: company.industry,
      organizer: company.name,
      region: company.country_region,
      summary: company.short_info,
      signals: company.public_signals,
      officialUrl: company.official_website,
      significanceScore: existing?.significanceScore ?? 50,
      scoreRationale: existing?.scoreRationale ?? "企业背景资料未提供人工含金量评分；请依据候选人的具体岗位、职责和成果单独评估。",
      verificationStatus: existing?.verificationStatus ?? "示例资料，待核验",
      updatedAt: existing?.updatedAt ?? company.source.accessed_at,
      evidenceSources: [{
        id: `${id}-source-1`,
        title: company.source.title,
        url: company.source.url,
        sourceType: "official",
        dataYear: "",
        note: `${company.source.source_type} · 整理日期 ${company.source.accessed_at}。${company.notes}`,
        verified: false,
        checkedAt: "",
      }],
      company: profile,
    };
  });
  return [...records, ...seeds.filter((record) => !mergedIds.has(record.id))];
}
