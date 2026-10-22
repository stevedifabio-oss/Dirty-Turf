import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectApplePublicMetadata } from "./store-metadata.mjs";

const metadata = JSON.parse(readFileSync(new URL("../../store/metadata.json", import.meta.url), "utf8"));

describe("Apple public store metadata", () => {
  it("accepts the iPhone and iPad listing while preserving cross-platform Google Play copy", () => {
    expect(metadata.apple.description).toContain("on iPhone and iPad.");
    expect(metadata.googlePlay.fullDescription).toContain("desktop, iPhone, and Android");
    expect(inspectApplePublicMetadata(metadata).failures).toEqual([]);
  });

  it("rejects the description that caused the platform-reference rejection", () => {
    const candidate = structuredClone(metadata);
    candidate.apple.description = metadata.googlePlay.fullDescription;
    expect(inspectApplePublicMetadata(candidate).failures).toEqual([
      "Apple description references another mobile platform: Android",
    ]);
  });

  it.each(["subtitle", "promotionalText", "description", "keywords"])("checks the public %s field", (field) => {
    const candidate = structuredClone(metadata);
    candidate.apple[field] = "Also available on aNdRoId.";
    expect(inspectApplePublicMetadata(candidate).failures).toHaveLength(1);
  });

  it("checks the public app name", () => {
    const candidate = structuredClone(metadata);
    candidate.identity.name = "Dirty Turf for Android";
    expect(inspectApplePublicMetadata(candidate).failures).toEqual([
      "Apple app name references another mobile platform: Android",
    ]);
  });

  it.each(["Google Play", "Play Store", "ARCore", "Galaxy Store", "Amazon Appstore", "Fire OS", "Windows Phone", "BlackBerry"])("rejects %s references", (platform) => {
    const candidate = structuredClone(metadata);
    candidate.apple.description = `Use ${platform} for field tools.`;
    expect(inspectApplePublicMetadata(candidate).failures).toHaveLength(1);
  });

  it("allows private reviewer notes to explain platform-specific behavior", () => {
    const candidate = structuredClone(metadata);
    candidate.apple.reviewerNotes = "iPhone uses ARKit; the separate Android app uses ARCore.";
    expect(inspectApplePublicMetadata(candidate).failures).toEqual([]);
  });
});
