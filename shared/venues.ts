import database from "../db/papers.json" with { type: "json" };
import type { KnowledgeRecord } from "./knowledge.js";
import type { VenueProfile } from "./venue-profile.js";

export const venueCatalog = database.records as VenueProfile[];
const seedIds: Record<string, string> = {
  "conf-neurips": "journal-neurips", "conf-cvpr": "journal-cvpr", "conf-acl": "journal-acl",
  "conf-kdd": "journal-kdd", "journal-tse": "journal-ieee-tse",
};
const plain = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

export function mergeVenueCatalog(seeds: KnowledgeRecord[]): KnowledgeRecord[] {
  const mergedIds = new Set<string>();
  const records = venueCatalog.map((venue): KnowledgeRecord => {
    const existing = seeds.find((record) => record.kind === "journal" &&
      (record.id === (seedIds[venue.id] ?? venue.id) || plain(record.title) === plain(venue.name)));
    if (existing) mergedIds.add(existing.id);
    const id = existing?.id ?? `catalog-${venue.id}`;
    return {
      ...existing, id, kind: "journal", title: venue.name,
      aliases: [...new Set([venue.abbreviation, ...venue.aliases, ...(existing?.aliases ?? []), ...(existing ? [existing.title] : [])])].filter((alias) => alias !== venue.name),
      field: venue.field.join(" / "), organizer: venue.publisher_or_organizer, region: venue.scope,
      summary: venue.short_info, signals: existing?.signals ?? ["论文正式发表状态", "文种及发表轨道", "作者贡献", "分级版本及适用范围"],
      officialUrl: venue.official_website,
      // Retained only for compatibility with the human review form, never inferred from rankings.
      significanceScore: existing?.significanceScore ?? 50,
      scoreRationale: existing?.scoreRationale ?? "已整理发表渠道背景，尚无人工评分。应结合论文、年份、轨道及个人贡献评估。",
      verificationStatus: existing?.verificationStatus ?? "示例资料，待核验", updatedAt: existing?.updatedAt ?? "",
      evidenceSources: venue.sources.map((source, index) => ({
        id: `${id}-source-${index + 1}`, title: source.title, url: source.url, sourceType: "other", dataYear: "",
        verified: false, checkedAt: "", note: `${source.source_type} · ${source.access}；整理日期 ${venue.checked_on}。${source.information}`,
      })), venue,
    };
  });
  return [...records, ...seeds.filter((record) => !mergedIds.has(record.id))];
}

export function venueSearchText(record: KnowledgeRecord): string {
  const venue = record.venue;
  return [record.title, ...record.aliases, record.field, record.organizer, record.summary, venue?.scope, venue?.info,
    venue?.influence, venue?.difficulty, venue?.ranking_note, ...(venue?.notes ?? []),
    ...(venue?.rankings ?? []).flatMap((ranking) => [ranking.system, ranking.edition, ranking.category, ranking.rank, ranking.applies_to]),
    ...(venue?.sources ?? []).flatMap((source) => [source.title, source.information]),
  ].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
}

const ambiguous = new Set(["ai", "cl", "pr", "nn", "mm", "sc", "自然", "科学", "nature", "science",
  "computer science", "计算机科学", "计算机工程", "计算机工程与应用", "人工智能", "模式识别", "神经网络",
  "artificial intelligence", "pattern recognition", "neural networks", "information sciences", "knowledge-based systems", "machine intelligence research"]);
function explicitVenueContext(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(text.lastIndexOf("\n", index - 1) + 1, index - 50), index);
  const end = text.indexOf("\n", index + length);
  const after = text.slice(index + length, Math.min(end < 0 ? text.length : end, index + length + 25));
  return /(?:发表于|发表在|刊登于|投稿至|投至|期刊|杂志|会议|发表渠道|published\s+(?:in|at)|paper\s+(?:in|at)|journal)\s*[:：]?\s*$/i.test(before)
    || /^\s*(?:期刊|杂志|会议|journal\b|conference\b)/i.test(after)
    || (/[《“"]$/.test(before) && /^[》”"]/.test(after));
}

export function findVenueMatch(text: string, record: KnowledgeRecord): string | null {
  const lower = text.toLocaleLowerCase();
  for (const term of [record.title, ...record.aliases].sort((a, b) => b.length - a.length)) {
    const candidate = term.trim();
    if (!candidate) continue;
    const needle = candidate.toLocaleLowerCase();
    let index = lower.indexOf(needle);
    while (index >= 0) {
      const adjacent = (value: string) => /[\p{Script=Latin}\p{N}]/u.test(value);
      const previous = Array.from(text.slice(0, index)).at(-1) ?? "";
      const next = Array.from(text.slice(index + candidate.length))[0] ?? "";
      if (!adjacent(previous) && !adjacent(next) && (!ambiguous.has(needle) || explicitVenueContext(text, index, candidate.length))) {
        return text.slice(index, index + candidate.length);
      }
      index = lower.indexOf(needle, index + 1);
    }
  }
  return null;
}
