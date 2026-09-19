import { describe, expect, it } from "vitest";
import { NATIVE_AUTH_EMAIL_REDIRECT, NATIVE_AUTH_REDIRECT, parseNativeAuthRedirect } from "./authRedirect";

describe("native auth redirects", () => {
  it("accepts a PKCE authorization code on the app callback", () => {
    expect(parseNativeAuthRedirect(`${NATIVE_AUTH_REDIRECT}?code=secure-code&sb_flow_id=0123456789abcdef0123456789abcdef`)).toEqual({
      code: "secure-code",
      flowId: "0123456789abcdef0123456789abcdef",
      accessToken: undefined,
      refreshToken: undefined,
      error: undefined,
    });
  });

  it("uses the production HTTPS bridge for emailed native sign-ins", () => {
    expect(NATIVE_AUTH_EMAIL_REDIRECT).toBe("https://app.dirtyturf.com/mobile-auth-callback.html");
  });

  it("supports an implicit-token callback for older invite links", () => {
    expect(parseNativeAuthRedirect(`${NATIVE_AUTH_REDIRECT}#access_token=access&refresh_token=refresh`)).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("returns a readable provider error", () => {
    expect(parseNativeAuthRedirect(`${NATIVE_AUTH_REDIRECT}?error_description=Link%20expired`)?.error).toBe("Link expired");
  });

  it("ignores malformed and unrelated links", () => {
    expect(parseNativeAuthRedirect("not a url")).toBeNull();
    expect(parseNativeAuthRedirect("https://app.dirtyturf.com/auth/callback?code=nope")).toBeNull();
    expect(parseNativeAuthRedirect("com.dirtyturf.academy://other/callback?code=nope")).toBeNull();
  });
});
