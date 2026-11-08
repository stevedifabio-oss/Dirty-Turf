import { describe, expect, it, vi } from "vitest";
import { APP_RELEASE_MANIFEST_URL, appStoreUrl, fetchAppRelease, isNewerAppRelease, selectAppRelease, type AppRelease } from "./appUpdates";

const now = Date.parse("2026-11-01T12:00:00Z");
const release: AppRelease = { availableVersion: "1.0.1", availableBuild: "18", publishedAt: "2026-10-31T12:00:00Z", expiresAt: "2026-12-01T12:00:00Z", releaseNotes: "Improved lessons." };
const manifest = { schemaVersion: 1, ios: release, android: null };
describe("public app release selection", () => {
  it("keeps Apple and Google availability separate", () => {
    expect(selectAppRelease(manifest, "ios", now)).toEqual(release);
    expect(selectAppRelease(manifest, "android", now)).toBeNull();
    expect(selectAppRelease({ schemaVersion: 1, ios: null, android: null }, "ios", now)).toBeNull();
  });
  it("ignores invalid, future, and expired announcements", () => {
    for (const value of [null, {}, { ...manifest, schemaVersion: 2 }, { ...manifest, ios: { ...release, availableVersion: "1.0-beta" } }, { ...manifest, ios: { ...release, expiresAt: "2026-11-01T12:00:00Z" } }, { ...manifest, ios: { ...release, publishedAt: "2027-01-01" } }, { ...manifest, ios: { ...release, expiresAt: "bad" } }, { ...manifest, ios: { ...release, releaseNotes: "x".repeat(2001) } }]) {
      expect(selectAppRelease(value, "ios", now)).toBeNull();
    }
  });
  it("compares numeric versions and the installed build without offering downgrades", () => {
    expect(isNewerAppRelease(release, { version: "1.0", build: "17" }, "ios")).toBe(true);
    expect(isNewerAppRelease(release, { version: "1.0.1", build: "18" }, "ios")).toBe(false);
    expect(isNewerAppRelease(release, { version: "1.0.1", build: "17" }, "ios")).toBe(true);
    expect(isNewerAppRelease(release, { version: "1.0.10", build: "1" }, "ios")).toBe(false);
    expect(isNewerAppRelease({ ...release, availableVersion: "1.10" }, { version: "1.9", build: "99" }, "ios")).toBe(true);
    expect(isNewerAppRelease({ ...release, availableBuild: "18.2" }, { version: "1.0.1", build: "18.1" }, "ios")).toBe(true);
    expect(isNewerAppRelease(release, { version: "1.0.1", build: "17" }, "android")).toBe(true);
    expect(isNewerAppRelease({ ...release, availableBuild: "18.2" }, { version: "1.0.1", build: "17" }, "android")).toBe(false);
    expect(isNewerAppRelease(release, { version: "unknown", build: "17" }, "ios")).toBe(false);
  });
  it("links only to the fixed real store listings", () => {
    expect(appStoreUrl("ios")).toBe("https://apps.apple.com/app/id6813588770");
    expect(appStoreUrl("android")).toBe("https://play.google.com/store/apps/details?id=com.dirtyturf.academy");
  });
});
describe("read-only release checks", () => {
  it("fetches only the canonical public manifest without credentials or redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } }));
    expect(await fetchAppRelease("ios", now, fetcher)).toEqual(release);
    expect(fetcher).toHaveBeenCalledWith(APP_RELEASE_MANIFEST_URL, expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
  });
  it("silently ignores offline, malformed, stale, oversized, or missing data", async () => {
    const offline = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await fetchAppRelease("ios", now, offline)).toBeNull();
    for (const response of [new Response("missing", { status: 404 }), new Response("<html>SPA</html>"), new Response("{bad", { headers: { "content-type": "application/json" } }), new Response("x".repeat(16_385), { headers: { "content-type": "application/json" } }), new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } })]) {
      expect(await fetchAppRelease("ios", Date.parse("2027-01-01"), vi.fn().mockResolvedValue(response))).toBeNull();
    }
  });
});
