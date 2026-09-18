import { describe, expect, it } from "vitest";
import { NATIVE_AUTH_REDIRECT, parseNativeAuthRedirect } from "./authRedirect";

describe("native auth redirects", () => {
  it("accepts a PKCE authorization code on the app callback", () => {
    expect(parseNativeAuthRedirect(`${NATIVE_AUTH_REDIRECT}?code=secure-code`)).toEqual({
      code: "secure-code",
      accessToken: undefined,
      refreshToken: undefined,
      error: undefined,
    });
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
    expect(parseNativeAuthRedirect("https://academy.dirtyturf.com/auth/callback?code=nope")).toBeNull();
    expect(parseNativeAuthRedirect("com.dirtyturf.academy://other/callback?code=nope")).toBeNull();
  });
});
