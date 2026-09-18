import { describe, expect, it } from "vitest";
import { communityMediaStoragePaths, normalizeCommunityMediaItems } from "./communityMedia";

describe("community media", () => {
  it("collects private object paths and resolves signed images", () => {
    const media = [
      { url: "https://source.example/photo.webp", storage_path: "community/shared/photo.webp", mime_type: "image/webp" },
      { url: "https://source.example/duplicate.webp", storage_path: "community/shared/photo.webp", mime_type: "image/webp" },
    ];
    expect(communityMediaStoragePaths(media)).toEqual(["community/shared/photo.webp", "community/shared/photo.webp"]);
    expect(normalizeCommunityMediaItems(media, new Map([["community/shared/photo.webp", "https://project.supabase.co/signed/photo"]]))).toEqual([
      {
        kind: "image",
        url: "https://project.supabase.co/signed/photo",
        originalUrl: "https://source.example/photo.webp",
        label: "source.example",
      },
      {
        kind: "image",
        url: "https://project.supabase.co/signed/photo",
        originalUrl: "https://source.example/duplicate.webp",
        label: "source.example",
      },
    ]);
  });

  it("keeps safe external links and rejects unsafe URLs", () => {
    const items = normalizeCommunityMediaItems([
      { url: "https://example.com/resource" },
      { url: "javascript:alert(1)" },
      { url: "/relative-file" },
    ], new Map());
    expect(items).toEqual([{ kind: "link", url: "https://example.com/resource", label: "example.com" }]);
  });
});
