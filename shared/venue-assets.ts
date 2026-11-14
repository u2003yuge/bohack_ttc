import manifest from "../db/paper-logo-assets.json" with { type: "json" };
import type { VenueProfile } from "./venue-profile.js";

export type VenueLogoAsset = {
  sourcePath: string | null;
  displayPath: string | null;
  status: "ready" | "invalid" | "missing" | "not_found";
  notes: string;
  sourceSha256?: string;
  displaySha256?: string;
  detectedFormat?: string;
  width?: number;
  height?: number;
};
export const venueLogoAssets = manifest.assets as Record<string, VenueLogoAsset>;

export function venueLogoAsset(venue?: VenueProfile): VenueLogoAsset | undefined {
  if (!venue?.logo) return undefined;
  const asset = venueLogoAssets[venue.id];
  // A restored or custom record cannot use another venue's local asset by changing its path.
  return asset?.sourcePath === venue.logo.path ? asset : undefined;
}
