import { describe, expect, it, vi } from "vitest";
import termsSource from "../../public/terms.html?raw";
import privacySource from "../../public/privacy.html?raw";
import { legalDocumentForReader, loadLegalDocument } from "./legalDocument";

describe("public legal document reader", () => {
  it("reads a fixed local document as text without forwarding credentials or navigating the app", async () => {
    const html = "<!doctype html><title>Terms</title><main>Community rules</main>";
    const fetcher = vi.fn(async () => new Response(html));
    expect(await loadLegalDocument("terms", undefined, fetcher)).toBe(html);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/terms.html", { credentials: "omit", redirect: "error", signal: undefined });
  });
  it("rejects failed requests, an SPA fallback and oversized documents", async () => {
    await expect(loadLegalDocument("privacy", undefined, async () => new Response("", { status: 503 }))).rejects.toThrow("could not load");
    await expect(loadLegalDocument("privacy", undefined, async () => new Response('<div id="root"></div>'))).rejects.toThrow("unavailable");
    await expect(loadLegalDocument("terms", undefined, async () => new Response(`<title>Terms</title><main>${"x".repeat(256 * 1024)}</main>`))).rejects.toThrow("unavailable");
  });
  it("rejects arbitrary URLs before making a request", async () => {
    const fetcher = vi.fn();
    await expect(loadLegalDocument("https://example.invalid/private" as "terms", undefined, fetcher)).rejects.toThrow("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("turns legal and ordinary anchors into noninteractive text while preserving their content", async () => {
    const html = '<title>Terms</title><main><a href="/privacy.html">Privacy</a><a href="/support.html" target="_self">Support</a><a href="mailto:hello@dirtyturf.com">hello@dirtyturf.com</a><A\nHREF=\'/delete-account.html\' class="button secondary">Delete account</A><a href="https://example.invalid/?value=>" onclick="navigate()" class="brand"><img src="/logo.png" alt="" />Brand</a></main>';
    const result = await loadLegalDocument("terms", undefined, async () => new Response(html));
    expect(result).not.toMatch(/<\/?a(?=[\s>])/i);
    expect(result).not.toMatch(/href|target|onclick|navigate\(\)/i);
    expect(result).toContain("<span>Privacy</span>"); expect(result).toContain("<span>Support</span>");
    expect(result).toContain("<span>hello@dirtyturf.com</span>"); expect(result).toContain("<span>Delete account</span>");
    expect(result).toContain('<span class="brand"><img src="/logo.png" alt="" />Brand</span>');
  });
  it.each([["terms", termsSource], ["privacy", privacySource]])("keeps the actual public %s document wording but removes embedded navigation in the reader copy", (_name, source) => {
    const result = legalDocumentForReader(source);
    expect(source).toMatch(/<a\s/i); expect(result).not.toMatch(/<\/?a(?=[\s>])/i);
    expect(result).toContain("<main"); expect(result).toContain("hello@dirtyturf.com");
    expect(result).toContain('<link rel="stylesheet" href="/legal.css"');
    expect(source).toMatch(/<a\s/i);
  });
});
