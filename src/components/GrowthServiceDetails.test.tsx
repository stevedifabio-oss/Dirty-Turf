import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { growthServices } from "../lib/growth";
import { GrowthServiceDetails } from "./GrowthServiceDetails";

vi.mock("../lib/backend", () => ({ supabase: null }));

describe("native business service browsing", () => {
  it.each(growthServices)("keeps $key content accessible without a request or purchase flow", service => {
    const html = renderToStaticMarkup(<GrowthServiceDetails service={service} requestId="native-request" readOnly browseOnly />);
    expect(html).toContain(`${service.title.replaceAll("&", "&amp;")} details`);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('href="#native-request"');
    expect(html).not.toMatch(/href="\/(?:membership|billing)/);
    expect(html).not.toContain("Request details below");
    if (service.key !== "ghl-subscription") expect(html).toContain("<details");
  });
});
