import { ArrowRight } from "lucide-react";
import type { GrowthService } from "../lib/growth";
import { GrowthWebsiteContent } from "./GrowthWebsiteContent";
import { GrowthSeoContent } from "./GrowthSeoContent";
import { GrowthWebsiteCareContent } from "./GrowthWebsiteCareContent";
import { GrowthGhlContent } from "./GrowthGhlContent";
import { GrowthAdsContent } from "./GrowthAdsContent";

export function GrowthServiceDetails({ service, requestId, readOnly = false, onPrepareRequest }: { service: GrowthService; requestId: string; readOnly?: boolean; onPrepareRequest?: (summary: string) => boolean }) {
  return <article aria-label={`${service.title} details`}>
    {service.key === "website" ? <GrowthWebsiteContent /> : service.key === "seo-aeo" ? <GrowthSeoContent requestId={requestId} readOnly={readOnly} /> : service.key === "website-care" ? <GrowthWebsiteCareContent service={service} requestId={requestId} readOnly={readOnly} /> : service.key === "ghl" ? <GrowthGhlContent service={service} requestId={requestId} readOnly={readOnly} onPrepareRequest={onPrepareRequest} /> : service.key === "facebook-ads" ? <GrowthAdsContent service={service} requestId={requestId} readOnly={readOnly} onPrepareRequest={onPrepareRequest} /> : <div className="growth-marketing-body"><h2>{service.title}</h2><p>{service.summary}</p></div>}
    {!readOnly && <a className="primary-button" href={`#${requestId}`}>{service.key === "website" ? "Get Started — Build My Website" : service.key === "seo-aeo" ? "Get Started — Improve My Search Presence" : service.key === "website-care" ? "Request Website Maintenance" : service.key === "ghl" ? "Get My GoHighLevel Setup Quote" : service.key === "facebook-ads" ? "Request My Ads Consultation" : `Get started with ${service.title}`}<ArrowRight size={18} aria-hidden="true" /></a>}
    <p className="growth-quote-note">Request details below. Project scope and final price are confirmed before payment.</p>
  </article>;
}
