import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommunityMediaGallery } from "./CommunityMediaGallery";

describe("community attachment rendering", () => {
  it("labels comment attachments and provides native image/video loading and playback", () => {
    const html = renderToStaticMarkup(<CommunityMediaGallery context="Comment" items={[
      { kind: "image", url: "https://cdn.example.com/after.webp", label: "After cleaning" },
      { kind: "video", url: "https://cdn.example.com/reply.mp4", label: "Reply walkthrough" },
      { kind: "file", url: "https://cdn.example.com/checklist.pdf", label: "Cleaning checklist" },
    ]} />);
    expect(html).toContain('aria-label="Comment attachments"');
    expect(html).toContain('alt="After cleaning"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('<video');
    expect(html).toContain('controls=""');
    expect(html).toContain('playsInline=""');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('aria-label="Reply walkthrough"');
    expect(html).toContain('Cleaning checklist');
    expect(html).toContain('Open attachment');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders no gallery for empty or unsafe attachments", () => {
    expect(renderToStaticMarkup(<CommunityMediaGallery items={[]} />)).toBe("");
    expect(renderToStaticMarkup(<CommunityMediaGallery items={[
      { kind: "image", url: "javascript:alert(1)", label: "Bad source" },
      { kind: "file", url: "https://user:password@example.com/file", label: "Credentials" },
    ]} />)).toBe("");
  });
});
