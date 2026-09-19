import { describe, expect, it } from "vitest";
import {
  buildAndroidIntentUrl,
  buildNativeAuthUrl,
  preferredAppUrl,
} from "../../public/mobile-auth-callback.js";

describe("mobile auth callback bridge", () => {
  it("carries the PKCE code and flow id into the installed app", () => {
    const url = buildNativeAuthUrl("?code=secure-code&sb_flow_id=0123456789abcdef0123456789abcdef");
    expect(url).toBe("com.dirtyturf.academy://auth/callback?code=secure-code&sb_flow_id=0123456789abcdef0123456789abcdef");
  });

  it("does not forward unrelated query parameters", () => {
    const url = buildNativeAuthUrl("?code=secure-code&next=https%3A%2F%2Fevil.example");
    expect(url).toBe("com.dirtyturf.academy://auth/callback?code=secure-code");
  });

  it("uses an Android package-scoped intent from an HTTPS browser", () => {
    const nativeUrl = buildNativeAuthUrl("?code=secure-code");
    expect(buildAndroidIntentUrl(nativeUrl)).toBe(
      "intent://auth/callback?code=secure-code#Intent;scheme=com.dirtyturf.academy;package=com.dirtyturf.academy;end",
    );
    expect(preferredAppUrl(nativeUrl, "Mozilla/5.0 (Linux; Android 16)")).toContain("package=com.dirtyturf.academy");
  });

  it("keeps the custom scheme on non-Android devices", () => {
    const nativeUrl = buildNativeAuthUrl("?code=secure-code");
    expect(preferredAppUrl(nativeUrl, "Mozilla/5.0 (iPhone)")).toBe(nativeUrl);
  });
});
