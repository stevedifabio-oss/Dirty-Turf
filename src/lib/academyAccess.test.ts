import { describe, expect, it } from "vitest";
import { communityAvailable, courseAvailable, featureAvailable, parseAcademyAccess } from "./academyAccess";
const raw = { hasAccess: true, canManage: false, pricingGatesEnabled: true, communityAccess: true, courseIds: ["certification"], features: [] };
describe("effective pricing gates", () => {
  it("keeps legacy access when the server explicitly disables gates", () => {
    const access = parseAcademyAccess({ ...raw, pricingGatesEnabled: false });
    expect(featureAvailable(access, "measuring_tool")).toBe(true);
    expect(courseAvailable(access, "full-course")).toBe(true);
  });
  it("keeps grandfathered community/certification separate from paid courses and tools", () => {
    const access = parseAcademyAccess(raw);
    expect(communityAvailable(access)).toBe(true);
    expect(courseAvailable(access, "certification")).toBe(true);
    expect(courseAvailable(access, "full-course")).toBe(false);
    expect(courseAvailable(access)).toBe(false);
    expect(featureAvailable(access, "measuring_tool")).toBe(false);
  });
  it("does not grant community to a member with only a purchased course", () => {
    const access = parseAcademyAccess({ ...raw, communityAccess: false, courseIds: ["tile-grout"] });
    expect(communityAvailable(access)).toBe(false);
    expect(courseAvailable(access, "tile-grout")).toBe(true);
  });
  it("preserves verified member identity without granting access", () => {
    const access = parseAcademyAccess({ hasAccess: false, memberId: "11111111-1111-1111-1111-111111111111" });
    expect(access).toEqual({ status: "no_access", hasMemberIdentity: true });
    expect(communityAvailable(access)).toBe(false);
    expect(featureAvailable(access, "measuring_tool")).toBe(false);
    expect(parseAcademyAccess({ hasAccess: false, memberId: "arbitrary" })).toEqual({ status: "no_access", hasMemberIdentity: false });
  });
  it("fails closed on errors and malformed or missing access flags", () => {
    for (const value of [null, {}, { ...raw, pricingGatesEnabled: undefined }, { ...raw, pricingGatesEnabled: "true" }, { ...raw, courseIds: null }, { ...raw, features: "measuring_tool" }, { ...raw, communityAccess: undefined }]) expect(() => parseAcademyAccess(value)).toThrow();
    for (const status of ["loading", "error", "signed_out", "no_access"] as const) {
      expect(communityAvailable({ status })).toBe(false);
      expect(featureAvailable({ status }, "measuring_tool")).toBe(false);
      expect(courseAvailable({ status }, "certification")).toBe(false);
    }
  });
});
