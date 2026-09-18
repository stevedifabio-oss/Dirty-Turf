import { describe, expect, it } from "vitest";
import { memberMagicLinkOptions, normalizeLoginEmail } from "./memberAuth";

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
