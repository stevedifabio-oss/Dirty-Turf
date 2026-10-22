import { describe, expect, it } from "vitest";
import { cleanCommunityPostBody, communityBodyBlocks, communityBodyNeedsExpansion, communityPostShareUrl } from "./communityPost";

describe("community post presentation", () => {
  it("preserves paragraphs and consecutive list items", () => {
    expect(communityBodyBlocks("Intro paragraph.\n\n- First item\n- Second item\n\nClosing thought.")).toEqual([
      { type: "paragraph", text: "Intro paragraph." },
      { type: "unordered-list", items: ["First item", "Second item"] },
      { type: "paragraph", text: "Closing thought." },
    ]);
  });

  it("recognizes ordered lists", () => {
    expect(communityBodyBlocks("1. Inspect the turf\n2) Measure the area")).toEqual([
      { type: "ordered-list", items: ["Inspect the turf", "Measure the area"] },
    ]);
  });

  it("removes duplicated GHL titles, counts, actions, and video controls", () => {
    expect(cleanCommunityPostBody("Costco turf installs?\n\nActual post copy.\n\n7\n\n5 Comments\n\nLike\n\nComment\n\nShare", "Costco turf installs?"))
      .toBe("Actual post copy.");
    expect(cleanCommunityPostBody("Video update\n\nhttps://example.test/video\n\nPlay\nRewind 10s\nForward 10s\n00:00\nMute\nSettings\nPIP\nEnter fullscreen\nPlay\n\nLike\nComment\nShare", "Video update"))
      .toBe("https://example.test/video");
    expect(cleanCommunityPostBody("", "Empty post")).toBe("");
  });

  it("only collapses long or structurally dense feed copy", () => {
    expect(communityBodyNeedsExpansion("A concise field update.")).toBe(false);
    expect(communityBodyNeedsExpansion("x".repeat(421))).toBe(true);
    expect(communityBodyNeedsExpansion("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight")).toBe(true);
  });

  it("creates a clean deep link without leaking the current query or fragment", () => {
    expect(communityPostShareUrl("https://app.dirtyturf.com/tools?sessionKey=private#token", "post-123"))
      .toBe("https://app.dirtyturf.com/tools?view=community&post=post-123");
  });
});


describe("community notification destinations", () => {
  it("preserves an exact parent and reply from an email link", async () => {
    const {communityRequestFromSearch}=await import("./communityPost");
    expect(communityRequestFromSearch("?view=community&post=post-123&comment=reply-456")).toEqual({postId:"post-123",commentId:"reply-456"});
  });
  it("ignores orphan, ambiguous and malformed reply destinations", async () => {
    const {communityRequestFromSearch}=await import("./communityPost");
    expect(communityRequestFromSearch("?comment=reply-456")).toEqual({postId:undefined,commentId:undefined});
    expect(communityRequestFromSearch("?post=first&post=other&comment=reply")).toEqual({postId:undefined,commentId:undefined});
    expect(communityRequestFromSearch("?post=valid&comment=https://example.invalid/path")).toEqual({postId:"valid",commentId:undefined});
    expect(communityRequestFromSearch("?post="+"a".repeat(129))).toEqual({postId:undefined,commentId:undefined});
  });
});
