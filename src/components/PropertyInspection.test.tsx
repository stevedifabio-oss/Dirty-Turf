import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertyInspection, SavedInspection } from "./PropertyInspection";

describe("property inspection presentation", () => {
  it("starts optional choices unanswered and supports camera and multi-photo uploads", () => {
    const html = renderToStaticMarkup(<PropertyInspection value={{}} onChange={() => undefined} photos={[]} onPhotosChange={() => undefined} onError={() => undefined} />);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('maxLength="2000"');
  });
  it("shows missing inspection values honestly and renders notes as text", () => {
    const html = renderToStaticMarkup(<SavedInspection inspection={{ condition: "fair", notes: "<script>unsafe</script>" }} />);
    expect(html).toContain("Fair");
    expect(html.match(/Not recorded/g)).toHaveLength(3);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(renderToStaticMarkup(<SavedInspection />)).toContain("No inspection was recorded");
  });
});
