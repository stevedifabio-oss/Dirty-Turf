import { describe, expect, it } from "vitest";
import { communityMediaStoragePaths, normalizeCommunityMediaItems, safeCommunityMediaUrl } from "./communityMedia";

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

  it("retains verified source media types before storage has supplied a MIME type", () => {
    expect(normalizeCommunityMediaItems([
      { url: "https://assets.clientclub.net/photo", type: "image", name: "Job result" },
      { url: "https://assets.clientclub.net/video", type: "video", name: "Walkthrough" },
      { url: "https://assets.clientclub.net/file", type: "file", name: "Cleaning checklist.pdf" },
      { url: "https://example.com/resource", type: "source-asset", name: "Shared page" },
    ], new Map()).map(item => [item.kind, item.label])).toEqual([
      ["image", "Job result"], ["video", "Walkthrough"], ["file", "Cleaning checklist.pdf"], ["link", "Shared page"],
    ]);
  });

  it("uses verified object MIME information ahead of source type", () => {
    expect(normalizeCommunityMediaItems([{ url: "https://example.com/asset", type: "image", mime_type: "application/pdf" }], new Map())[0].kind).toBe("file");
    expect(normalizeCommunityMediaItems([{ url: "https://example.com/asset", type: "source-asset", mime_type: "application/pdf" }], new Map())[0].kind).toBe("file");
  });

  it.each(["javascript:alert(1)", "http://example.com/x", "https://user:password@example.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://foo.internal/x", "https://example.com:8443/x", "https://[::1]/x", "https://example.com/a b", "https://example.com/\\x"])("rejects unsafe attachment URL %s", url => {
    expect(safeCommunityMediaUrl(url)).toBeUndefined();
    expect(normalizeCommunityMediaItems([{ url, type: "image" }], new Map())).toEqual([]);
  });
});
