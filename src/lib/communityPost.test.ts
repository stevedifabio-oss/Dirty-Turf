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
