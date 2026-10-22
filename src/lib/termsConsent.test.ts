import { describe, expect, it } from "vitest";
import { COMMUNITY_TERMS_VERSION, createTermsConsent } from "./termsConsent";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe("versioned community terms consent", () => {
  it("requires an explicit acceptance and binds anonymous acceptance to the first authenticated account", () => {
    const local = storage(), consent = createTermsConsent(local, () => new Date("2026-10-18T12:00:00Z"));
    expect(consent.granted()).toBe(false); expect(consent.canProcessNativeLink()).toBe(false);
    consent.identify(null); consent.accept(); expect(consent.granted()).toBe(true);
    expect(consent.identify("member-one")).toBe(true);
    expect([...local.values.values()].map(value => JSON.parse(value))).toEqual([{ version: COMMUNITY_TERMS_VERSION, acceptedAt: "2026-10-18T12:00:00.000Z", userId: "member-one" }]);
    expect(consent.identify("member-two")).toBe(false);
    expect(consent.identify(null)).toBe(false);
  });
  it("restores only the current version for the matching returning member", () => {
    const local = storage(), consent = createTermsConsent(local);
    consent.identify("member-one"); consent.accept();
    const restored = createTermsConsent(local);
    expect(restored.identify("member-one")).toBe(true);
    expect(restored.identify("member-two")).toBe(false);
    const [key, raw] = [...local.values.entries()][0];
    local.setItem(key, JSON.stringify({ ...JSON.parse(raw), version: "older-revision" }));
    expect(createTermsConsent(local).identify("member-one")).toBe(false);
    local.setItem(key, "broken"); expect(createTermsConsent(local).granted()).toBe(false);
  });
  it("keeps consent only in memory when storage is unavailable and withdraws it explicitly", () => {
    const local = { getItem: () => { throw new Error("Blocked"); }, setItem: () => { throw new Error("Blocked"); }, removeItem: () => { throw new Error("Blocked"); } };
    const consent = createTermsConsent(local); expect(consent.granted()).toBe(false);
    consent.identify("member"); consent.accept(); expect(consent.granted()).toBe(true);
    consent.withdraw(); expect(consent.granted()).toBe(false);
  });
});
