import { describe, expect, it } from "vitest";
import { COMMUNITY_CONTENT_REJECTED_MESSAGE, communityWriteFailureMessage, isRemovedCommunityComment, nextBlockedMemberIds, REMOVED_COMMUNITY_COMMENT_BODY, validReportReason, withoutMemberContent } from "./communitySafety";

describe("community safety actions", () => {
  it("recognizes removed comment placeholders without hiding ordinary discussion", () => {
    expect(isRemovedCommunityComment(REMOVED_COMMUNITY_COMMENT_BODY)).toBe(true);
    expect(isRemovedCommunityComment(` ${REMOVED_COMMUNITY_COMMENT_BODY} `)).toBe(true);
    expect(isRemovedCommunityComment("A moderator helped with this attachment.")).toBe(false);
    expect(isRemovedCommunityComment(`Discussion about ${REMOVED_COMMUNITY_COMMENT_BODY}`)).toBe(false);
  });

  it("shows the known screening failure without exposing unrelated backend details", () => {
    expect(communityWriteFailureMessage(new Error(COMMUNITY_CONTENT_REJECTED_MESSAGE), "Try again")).toBe(COMMUNITY_CONTENT_REJECTED_MESSAGE);
    expect(communityWriteFailureMessage({ code: "23514", message: COMMUNITY_CONTENT_REJECTED_MESSAGE }, "Try again")).toBe(COMMUNITY_CONTENT_REJECTED_MESSAGE);
    expect(communityWriteFailureMessage({ message: "Internal database detail" }, "Try again")).toBe("Try again");
    expect(communityWriteFailureMessage(null, "Try again")).toBe("Try again");
  });

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
