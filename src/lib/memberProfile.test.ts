import { describe, expect, it, vi } from "vitest";
vi.mock("./backend", () => ({ supabase: null }));
import { emptyMemberProfile, validateMemberProfile, validateProfilePhoto } from "./memberProfile";
const valid = { name: "Alex Green", phone: "+1 (555) 123-4567", location: "Phoenix, Arizona, USA", about: "I run a turf cleaning company.", avatarPath: "selected", experience: "under_two_years" };
describe("signup profile validation", () => {
  it("accepts complete profiles and international phone numbers", () => {
    expect(validateMemberProfile(valid)).toBeNull();
    expect(validateMemberProfile({ ...valid, phone: "+44 20 7946 0958" })).toBeNull();
  });
  it.each(Object.keys(emptyMemberProfile) as (keyof typeof emptyMemberProfile)[])("requires %s", key => {
    expect(validateMemberProfile({ ...valid, [key]: "" })).not.toBeNull();
  });
  it.each(["abc123456789", "123", "1".repeat(16)])("rejects malformed phones %s", phone => {
    expect(validateMemberProfile({ ...valid, phone })).not.toBeNull();
  });
  it("limits biographies and rejects unsupported or oversized photos", () => {
    expect(validateMemberProfile({ ...valid, about: "x".repeat(501) })).not.toBeNull();
    expect(validateProfilePhoto({ type: "image/svg+xml", size: 400 } as File)).not.toBeNull();
    expect(validateProfilePhoto({ type: "image/jpeg", size: 5242881 } as File)).not.toBeNull();
    expect(validateProfilePhoto({ type: "image/jpeg", size: 0 } as File)).not.toBeNull();
    expect(validateProfilePhoto({ type: "image/png", size: 1024 } as File)).toBeNull();
  });
});
