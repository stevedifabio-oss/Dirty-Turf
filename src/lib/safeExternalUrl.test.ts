import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./safeExternalUrl";

describe("safeExternalUrl", () => {
  it("allows absolute HTTP and HTTPS media URLs", () => {
    expect(safeExternalUrl("https://cdn.example.com/lesson.mp4?token=abc")).toBe("https://cdn.example.com/lesson.mp4?token=abc");
    expect(safeExternalUrl(" http://localhost:54321/resource.pdf ")).toBe("http://localhost:54321/resource.pdf");
  });

  it("rejects executable, embedded, and relative URL schemes", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeExternalUrl("//attacker.example/file.pdf")).toBeUndefined();
    expect(safeExternalUrl("/local/file.pdf")).toBeUndefined();
  });

  it("rejects empty and malformed values", () => {
    expect(safeExternalUrl(undefined)).toBeUndefined();
    expect(safeExternalUrl("   ")).toBeUndefined();
    expect(safeExternalUrl("not a url")).toBeUndefined();
  });
});
