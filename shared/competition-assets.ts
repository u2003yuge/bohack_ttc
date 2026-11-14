import manifest from "../db/competition-logo-assets.json" with { type: "json" };
import type { CompetitionProfile } from "./competitions.js";

export type CompetitionLogoKind = "competition_logo" | "organization_icon" | "site_icon" | "platform_icon";
export type CompetitionLogoAsset = {
  name: string;
  reportYear: number;
  officialWebsite: string | null;
  sourcePath: string | null;
  sourceUrl: string | null;
  sourceKind: string | null;
  displayKind: CompetitionLogoKind | null;
  displayPath: string | null;
  status: "ready" | "rejected" | "invalid" | "not_found";
  notes: string;
  sourceSha256?: string;
  displaySha256?: string;
  detectedFormat?: string;
  width?: number;
  height?: number;
};

export const competitionLogoAssets = manifest.assets as Record<string, CompetitionLogoAsset>;
export const competitionLogoLabels: Record<CompetitionLogoKind, string> = {
  competition_logo: "赛事标识", organization_icon: "相关机构标识",
  site_icon: "来源网站图标", platform_icon: "赛事服务平台图标",
};

export function competitionLogoAsset(profile?: CompetitionProfile): CompetitionLogoAsset | undefined {
  if (!profile) return undefined;
  const asset = competitionLogoAssets[profile.id];
  // Use the original catalog identity, not the merged library ID, array order, or fuzzy names.
  return asset?.name === profile.name && asset.reportYear === profile.report_year
    && asset.officialWebsite === profile.official_website ? asset : undefined;
}
