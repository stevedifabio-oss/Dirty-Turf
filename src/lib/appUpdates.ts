export type AppPlatform = "ios" | "android";
export type AppRelease = {
  availableVersion: string;
  availableBuild: string;
  publishedAt: string;
  expiresAt: string;
  releaseNotes: string;
};
export type AppReleaseManifest = { schemaVersion: 1; ios: AppRelease | null; android: AppRelease | null };
export const APP_RELEASE_MANIFEST_URL = "https://app.dirtyturf.com/app-releases.json";
export const APP_RELEASE_CHECK_INTERVAL = 15 * 60_000;
export const APP_BUNDLE_ID = "com.dirtyturf.academy";
const storeUrls: Record<AppPlatform, string> = {
  ios: "https://apps.apple.com/app/id6813588770",
  android: "https://play.google.com/store/apps/details?id=com.dirtyturf.academy",
};
export const appStoreUrl = (platform: AppPlatform) => storeUrls[platform];
export const appReleaseKey = (platform: AppPlatform, release: AppRelease) => `${platform}:${release.availableVersion}:${release.availableBuild}`;

function numericParts(value: unknown): number[] | null {
  if (typeof value !== "string" || !/^\d{1,9}(?:\.\d{1,9}){0,3}$/.test(value)) return null;
  return value.split(".").map(Number);
}
function compareParts(left: number[], right: number[]) {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
export function isNewerAppRelease(release: AppRelease, installed: { version: string; build: string }, platform: AppPlatform): boolean {
  const version = numericParts(release.availableVersion), installedVersion = numericParts(installed.version);
  const build = numericParts(release.availableBuild), installedBuild = numericParts(installed.build);
  if (!version || !installedVersion || !build || !installedBuild) return false;
  if (platform === "android" && (build.length !== 1 || installedBuild.length !== 1)) return false;
  const difference = compareParts(version, installedVersion);
  return difference > 0 || (difference === 0 && compareParts(build, installedBuild) > 0);
}

/** Treat missing, expired, future, or malformed release announcements as unavailable. */
export function selectAppRelease(value: unknown, platform: AppPlatform, now = Date.now()): AppRelease | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) return null;
  const entry = manifest[platform];
  if (!entry || typeof entry !== "object") return null;
  const release = entry as Record<string, unknown>;
  const version = numericParts(release.availableVersion), build = numericParts(release.availableBuild);
  if (!version || !build || (platform === "android" && build.length !== 1)) return null;
  if (typeof release.publishedAt !== "string" || typeof release.expiresAt !== "string" || typeof release.releaseNotes !== "string" || release.releaseNotes.length > 2000) return null;
  const published = Date.parse(release.publishedAt), expires = Date.parse(release.expiresAt);
  if (!Number.isFinite(published) || !Number.isFinite(expires) || published > now || expires <= now || expires <= published) return null;
  return { availableVersion: release.availableVersion as string, availableBuild: release.availableBuild as string, publishedAt: release.publishedAt, expiresAt: release.expiresAt, releaseNotes: release.releaseNotes };
}

export async function fetchAppRelease(platform: AppPlatform, now = Date.now(), fetcher: typeof fetch = fetch): Promise<AppRelease | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(APP_RELEASE_MANIFEST_URL, { signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store" });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return null;
    const text = await response.text();
    if (text.length > 16_384) return null;
    return selectAppRelease(JSON.parse(text), platform, now);
  } catch { return null; }
  finally { clearTimeout(timeout); }
}
