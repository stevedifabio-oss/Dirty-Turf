import { describe, expect, it } from "vitest";
import { memberMagicLinkOptions, normalizeLoginEmail, webMagicLinkReturnUrl } from "./memberAuth";

describe("member authentication", () => {
  it("normalizes the invited email before requesting a link", () => {
    expect(normalizeLoginEmail("  Owner@TurfCo.COM ")).toBe("owner@turfco.com");
  });

  it("never creates an account from the public magic-link form", () => {
    expect(memberMagicLinkOptions("https://app.dirtyturf.com")).toEqual({
      emailRedirectTo: "https://app.dirtyturf.com",
      shouldCreateUser: false,
    });
  });
});


describe("safe web magic-link destinations", () => {
  it("returns to the exact post and reply without auth, tracking or redirect parameters", () => {
    const result=webMagicLinkReturnUrl("https://app.dirtyturf.com/?view=community&post=post-123&comment=reply-456&access_token=secret&redirect=https://outside.invalid&email=private@example.invalid#refresh_token=secret");
    expect(result).toBe("https://app.dirtyturf.com/?view=community&post=post-123&comment=reply-456");
  });
  it.each([["learn","course"],["events","event"]])("preserves the %s target only", (view,key) => {
    expect(webMagicLinkReturnUrl(`https://app.dirtyturf.com/?view=${view}&${key}=target-1&post=other`)).toBe(`https://app.dirtyturf.com/?view=${view}&${key}=target-1`);
  });
  it("keeps expired-member billing management but drops session/payment state", () => {
    expect(webMagicLinkReturnUrl("https://app.dirtyturf.com/billing?session_id=cs_secret&status=paid")).toBe("https://app.dirtyturf.com/billing");
    expect(webMagicLinkReturnUrl("https://app.dirtyturf.com/checkout/return?session_id=cs_secret")).toBe("https://app.dirtyturf.com/");
  });
  it("discards ambiguous, malformed and orphan destinations", () => {
    expect(webMagicLinkReturnUrl("https://app.dirtyturf.com/?view=community&comment=orphan")).toBe("https://app.dirtyturf.com/?view=community");
    expect(webMagicLinkReturnUrl("https://app.dirtyturf.com/?view=community&post=one&post=two&comment=reply")).toBe("https://app.dirtyturf.com/?view=community");
    expect(webMagicLinkReturnUrl("https://app.dirtyturf.com/?view=community&post=https://outside.invalid")).toBe("https://app.dirtyturf.com/?view=community");
    expect(webMagicLinkReturnUrl("https://app.dirtyturf.com/?view=constructor&panel=settings")).toBe("https://app.dirtyturf.com/?panel=settings");
  });
  it("drops arbitrary paths and credentials and only permits secure or local origins", () => {
    expect(webMagicLinkReturnUrl("https://user:password@app.dirtyturf.com/unexpected?next=https://outside.invalid")).toBe("https://app.dirtyturf.com/");
    expect(webMagicLinkReturnUrl("http://localhost:5173/?view=learn&course=course-1")).toBe("http://localhost:5173/?view=learn&course=course-1");
    expect(()=>webMagicLinkReturnUrl("javascript:alert(1)")).toThrow();
    expect(()=>webMagicLinkReturnUrl("http://app.dirtyturf.com/?view=learn")).toThrow("secure Academy");
  });
});
