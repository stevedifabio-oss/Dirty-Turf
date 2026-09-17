import { describe, expect, it } from "vitest";
import { ACADEMY_ORIGIN, buildAcademyUrl } from "./academyLinks";

describe("Dirty Turf Academy links", () => {
  it("opens the live course library after login", () => {
    const url = new URL(buildAcademyUrl("courses"));

    expect(url.origin).toBe(ACADEMY_ORIGIN);
    expect(url.searchParams.get("redirectUrl")).toBe("courses/library-v2");
    expect(url.searchParams.has("sessionKey")).toBe(false);
  });

  it("passes a valid session key to the live community", () => {
    const url = new URL(buildAcademyUrl("community", "signed-session-key"));

    expect(url.searchParams.get("redirectUrl")).toBe("communities");
    expect(url.searchParams.get("sessionKey")).toBe("signed-session-key");
  });

  it("opens events through the live community portal", () => {
    const url = new URL(buildAcademyUrl("events"));

    expect(url.searchParams.get("redirectUrl")).toBe("communities");
  });

  it("does not send a merge-field placeholder as a credential", () => {
    const url = new URL(buildAcademyUrl("courses", "{{user.sessionKey}}"));

    expect(url.searchParams.has("sessionKey")).toBe(false);
  });

  it("drops an unexpectedly large credential", () => {
    const url = new URL(buildAcademyUrl("community", "x".repeat(4097)));

    expect(url.searchParams.has("sessionKey")).toBe(false);
  });
});
