import { describe, expect, it } from "vitest";
import { nextBlockedMemberIds, validReportReason, withoutMemberContent } from "./communitySafety";

describe("community safety actions", () => {
  it("accepts only server-valid report reasons", () => {
    expect(validReportReason("  ok  ")).toBe(false);
    expect(validReportReason("Spam or harassment")).toBe(true);
    expect(validReportReason("x".repeat(501))).toBe(false);
  });

  it("keeps block and unblock state reversible without duplicate members", () => {
    expect(nextBlockedMemberIds(["a"], "a", true)).toEqual(["a"]);
    expect(nextBlockedMemberIds(["a"], "b", true)).toEqual(["a", "b"]);
    expect(nextBlockedMemberIds(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("hides only the blocked author's content", () => {
    const items = [{ authorCloudId: "a" }, { authorCloudId: "b" }, {}];
    expect(withoutMemberContent(items, "a")).toEqual([items[1], items[2]]);
  });
});
