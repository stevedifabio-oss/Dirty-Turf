import { describe, expect, it } from "vitest";
import {
  inspectAppHtml,
  inspectManifest,
  inspectPublicPages,
  inspectSecurityHeaders,
} from "./release-readiness.mjs";

const validHtml = `<!doctype html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta content="https://app.dirtyturf.com/" property="og:url" />
  <link href="/manifest.webmanifest" rel="manifest" />
  <link href="https://app.dirtyturf.com/" rel="canonical" />
  <title>Dirty Turf Academy</title>
</head></html>`;

const validManifest = {
  id: "/",
  name: "Dirty Turf Academy",
  short_name: "Dirty Turf",
  start_url: "/",
  scope: "/",
  display: "standalone",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
};

describe("release readiness", () => {
  it("accepts production metadata regardless of attribute order", () => {
    expect(inspectAppHtml(validHtml, "https://app.dirtyturf.com").failures).toEqual([]);
  });

  it("rejects a stale canonical domain", () => {
    const html = validHtml.replaceAll("https://app.dirtyturf.com/", "https://academy.dirtyturf.com/");
    const result = inspectAppHtml(html, "https://app.dirtyturf.com");
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toContain("Canonical URL must be");
  });

  it("requires installable PWA metadata", () => {
    expect(inspectManifest(validManifest).failures).toEqual([]);
    expect(inspectManifest({ ...validManifest, icons: [] }).failures).toEqual([
      "Manifest is missing a PNG 192x192 icon",
      "Manifest is missing a PNG 512x512 icon",
    ]);
  });

  it("guards the public support and provider disclosures", () => {
    expect(inspectPublicPages({
      privacy: "Supabase, Netlify, Mailgun, and Stripe",
      support: "Use a Magic Link. Live point-to-point camera measurement is supported.",
      deletion: "Request account deletion by emailing hello@dirtyturf.com",
    }).failures).toEqual([]);

    expect(inspectPublicPages({
      privacy: "Supabase, Resend, and Stripe",
      support: "Password support",
      deletion: "Contact us",
    }).failures).toContain("Privacy policy still mentions Resend");
  });

  it("requires the deployed security policy", () => {
    const headers = new Headers({
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(self), geolocation=(self), microphone=()",
    });
    expect(inspectSecurityHeaders(headers).failures).toEqual([]);
    headers.set("x-frame-options", "SAMEORIGIN");
    headers.set("referrer-policy", "same-origin");
    expect(inspectSecurityHeaders(headers).failures).toEqual([]);
    headers.delete("x-frame-options");
    expect(inspectSecurityHeaders(headers).failures).toContain("x-frame-options is missing or incorrect");
  });
});
