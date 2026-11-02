import { ArrowRight, ChevronDown } from "lucide-react";
import type { GrowthService } from "../lib/growth";
/** Website care copy supplied by Steve. */
export function GrowthWebsiteCareContent({ service, requestId, readOnly = false }: { service: GrowthService; requestId: string; readOnly?: boolean }) {
const price = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
return <div className="growth-marketing-body growth-service-description">
<header className="growth-website-intro"><h2>{"Website Care, Maintenance & Content Updates"}</h2>
<h4>{"Keep Your Turf Cleaning Website Updated, Optimized, and Growing."}</h4>
<p><strong>{"Your website shouldn't stop growing after it's launched. Neither should your business."}</strong></p>
<p>{"At Turf Cleaning Academy, we provide professional website care, maintenance, SEO updates, and ongoing content development specifically for artificial turf cleaning companies."}</p>
<p>{"Whether you need new service area pages, educational articles, blog posts, SEO improvements, promotional updates, or technical maintenance, our team handles the work so you can focus on running your business."}</p>
<p>{"As pioneers in the turf cleaning industry and operators of a seven-figure turf cleaning company, we understand what your customers are searching for and how to keep your website relevant, professional, and competitive."}</p>
<p><strong>{"One team. Complete website care. Ongoing improvements."}</strong></p>
<div className="growth-seo-actions"><a className="secondary-button" href="#website-care-plan">Explore Website Care Plans <ChevronDown size={17} aria-hidden="true" /></a>{!readOnly && <a className="primary-button" href={`#${requestId}`}>Request Website Maintenance <ArrowRight size={17} aria-hidden="true" /></a>}</div><div className="growth-website-highlights"><span><strong>Website</strong> maintenance</span><span><strong>SEO &amp; AEO</strong> updates</span><span><strong>Fresh</strong> content</span></div></header>
<figure className="growth-seo-overview" id="website-care-overview"><figcaption><strong>Website Care &amp; Updates — Illustrative Overview</strong><p>The dashboard, calendar, rankings, and growth figures are sample illustrations, not your live data or guaranteed results.</p></figcaption><a href="/images/website-care-overview.png" target="_blank" rel="noopener noreferrer" aria-label="View full website care overview image"><img src="/images/website-care-overview.png" alt="Website care and updates overview showing content updates, SEO improvements, maintenance, and illustrative performance dashboards." width={1536} height={1024} loading="lazy" decoding="async" /></a></figure>
<section className="growth-website-package" aria-labelledby="website-care-services"><h3 id="website-care-services">Everything Your Turf Cleaning Website Needs</h3><p>Explore our website care services. Your plan confirms the work included for your business.</p><div className="growth-package-options"><details className="growth-package-option"><summary><span className="growth-package-number">01</span><h4>{"Website Maintenance & Technical Care"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"We help keep your website functioning properly, looking professional, and providing a positive experience for potential customers."}</p>
<p>{"Services include:"}</p>
<ul>
<li>{"Website functionality checks"}</li>
<li>{"Broken link identification and repair"}</li>
<li>{"Contact form testing"}</li>
<li>{"Mobile responsiveness checks"}</li>
<li>{"Website speed and performance improvements"}</li>
<li>{"Image optimization"}</li>
<li>{"Plugin and software updates where applicable"}</li>
<li>{"Security and SSL monitoring"}</li>
<li>{"Website backups where supported"}</li>
<li>{"Navigation and layout corrections"}</li>
<li>{"Error troubleshooting"}</li>
<li>{"Basic technical SEO maintenance"}</li>
</ul>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">02</span><h4>{"Ongoing SEO Updates & Optimization"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"Search engine optimization isn't a one-time project. As your competitors improve their websites and customer search behavior changes, your website needs ongoing attention."}</p>
<p>{"Our SEO updates include:"}</p>
<ul>
<li>{"Page title and meta description improvements"}</li>
<li>{"Keyword research and optimization"}</li>
<li>{"H1, H2, and H3 heading updates"}</li>
<li>{"Existing content optimization"}</li>
<li>{"Internal linking improvements"}</li>
<li>{"Image alt text updates"}</li>
<li>{"Service page optimization"}</li>
<li>{"Search Console performance reviews"}</li>
<li>{"Technical SEO corrections"}</li>
<li>{"Local keyword targeting"}</li>
<li>{"Content refreshes"}</li>
<li>{"Relevant structured data updates"}</li>
</ul>
<p><strong>{"Keep your website aligned with SEO best practices as your business grows."}</strong></p>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">03</span><h4>{"New Service Area & City Pages"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p><strong>{"Expand your online presence into the cities and communities you serve."}</strong></p>
<p>{"We create professionally written, location-specific pages designed to help potential customers discover your turf cleaning services in their area."}</p>
<p>{"Examples:"}</p>
<ul>
<li>{"Turf Cleaning Phoenix, AZ"}</li>
<li>{"Turf Cleaning Scottsdale, AZ"}</li>
<li>{"Artificial Turf Cleaning Glendale, AZ"}</li>
<li>{"Pet Turf Cleaning Peoria, AZ"}</li>
<li>{"Artificial Turf Cleaning Henderson, NV"}</li>
</ul>
<p>{"Each service area page can include:"}</p>
<ul>
<li>{"Unique, locally relevant content"}</li>
<li>{"City-specific keyword research"}</li>
<li>{"SEO page title and meta description"}</li>
<li>{"Proper heading structure"}</li>
<li>{"Residential and commercial service information"}</li>
<li>{"Internal links to relevant services"}</li>
<li>{"Quote request calls to action"}</li>
<li>{"Mobile-friendly layout"}</li>
<li>{"Appropriate schema markup"}</li>
</ul>
<p>{"We focus on useful, original location pages rather than duplicate pages with city names swapped out."}</p>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">04</span><h4>{"New Service Pages"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"As your turf cleaning company expands, your website should reflect the services you offer."}</p>
<p>{"We can develop new, fully optimized pages for services such as:"}</p>
<ul>
<li>{"Pet Turf Cleaning"}</li>
<li>{"Artificial Turf Odor Removal"}</li>
<li>{"Turf Restoration"}</li>
<li>{"Commercial Turf Cleaning"}</li>
<li>{"Apartment & HOA Turf Cleaning"}</li>
<li>{"Gym & Fitness Turf Cleaning"}</li>
<li>{"Putting Green Cleaning"}</li>
<li>{"Turf Infill Replacement"}</li>
<li>{"Dog Park Turf Cleaning"}</li>
<li>{"Restaurant & Hospitality Turf Cleaning"}</li>
</ul>
<p>{"Each page is designed to explain the service, address customer questions, and encourage visitors to request a quote."}</p>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">05</span><h4>{"Educational Articles & Cleaning Guides"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"Build your website's authority with informative, professionally written content that helps customers understand artificial turf cleaning and maintenance."}</p>
<p>{"Example articles:"}</p>
<ul>
<li>{"The Complete Guide to Artificial Turf Cleaning"}</li>
<li>{"How to Remove Dog Urine Smell From Artificial Grass"}</li>
<li>{"Why Artificial Turf Smells After Rain"}</li>
<li>{"How Often Should You Professionally Clean Artificial Turf?"}</li>
<li>{"Artificial Turf Cleaning vs. Pressure Washing"}</li>
<li>{"Understanding Artificial Turf Infill"}</li>
<li>{"How to Maintain Artificial Turf With Multiple Dogs"}</li>
<li>{"Common Artificial Turf Maintenance Mistakes"}</li>
</ul>
<p>{"Articles can include relevant internal links, customer FAQs, images, and calls to action."}</p>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">06</span><h4>{"Ongoing Blog Post Creation"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"Keep your website active with fresh, relevant content."}</p>
<p>{"Blog topics can include:"}</p>
<ul>
<li>{"Seasonal Turf Cleaning Tips"}</li>
<li>{"Summer Turf Maintenance in Hot Climates"}</li>
<li>{"Preparing Artificial Turf for Winter"}</li>
<li>{"Pet Odor Prevention Tips"}</li>
<li>{"Commercial Turf Maintenance Recommendations"}</li>
<li>{"Artificial Turf Cleaning Equipment"}</li>
<li>{"Turf Cleaning Myths"}</li>
<li>{"New Services and Company Announcements"}</li>
<li>{"Customer Education and Maintenance Tips"}</li>
</ul>
<p>{"Blog posts are written for your audience and optimized around relevant search topics."}</p>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">07</span><h4>{"AEO & AI Search Content Updates"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"AI-powered search continues to change how consumers research services."}</p>
<p>{"We help structure and improve website content so AI-assisted search systems can more easily understand your company's services, expertise, and service areas."}</p>
<p>{"Services include:"}</p>
<ul>
<li>{"Answer-focused content updates"}</li>
<li>{"Frequently asked question sections"}</li>
<li>{"Conversational search optimization"}</li>
<li>{"Service descriptions written for clarity"}</li>
<li>{"Structured data reviews"}</li>
<li>{"Business information consistency"}</li>
<li>{"Educational content improvements"}</li>
<li>{"Relevant content updates for AI-assisted discovery"}</li>
</ul>
<p>{"No agency can guarantee placement or recommendations in AI-generated responses, but properly structured, useful content can improve your website's foundation for discovery."}</p>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">08</span><h4>{"Website Design & Content Updates"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"Need to change something on your website? Our team can handle routine updates without requiring you to hire a developer."}</p>
<p>{"Common requests include:"}</p>
<ul>
<li>{"Changing pricing or service descriptions"}</li>
<li>{"Updating company contact information"}</li>
<li>{"Adding new before-and-after photos"}</li>
<li>{"Updating customer testimonials"}</li>
<li>{"Creating promotional banners"}</li>
<li>{"Updating homepage sections"}</li>
<li>{"Adding new calls to action"}</li>
<li>{"Replacing images"}</li>
<li>{"Updating business hours"}</li>
<li>{"Adding seasonal promotions"}</li>
<li>{"Updating service descriptions"}</li>
<li>{"Improving page layouts"}</li>
</ul>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">09</span><h4>{"Lead Generation & Conversion Improvements"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"Your website should continually improve its ability to turn visitors into potential customers."}</p>
<p>{"We review and update:"}</p>
<ul>
<li>{"Quote request buttons"}</li>
<li>{"Contact forms"}</li>
<li>{"Click-to-call functionality"}</li>
<li>{"Mobile lead generation features"}</li>
<li>{"Customer review placement"}</li>
<li>{"Trust-building content"}</li>
<li>{"Service page calls to action"}</li>
<li>{"Landing page layouts"}</li>
<li>{"Internal navigation"}</li>
<li>{"Conversion tracking"}</li>
</ul>
</div></details>
<details className="growth-package-option"><summary><span className="growth-package-number">10</span><h4>{"Monthly Website Performance Reports"}</h4><ChevronDown size={20} aria-hidden="true" /></summary><div className="growth-package-content"><p>{"For ongoing care customers, we provide reporting on completed work and relevant website performance."}</p>
<p>{"Reports may include:"}</p>
<ul>
<li>{"Website maintenance completed"}</li>
<li>{"New pages and articles published"}</li>
<li>{"SEO updates performed"}</li>
<li>{"Organic traffic trends"}</li>
<li>{"Search impressions and clicks"}</li>
<li>{"Keyword ranking trends"}</li>
<li>{"Website inquiries and conversions"}</li>
<li>{"Technical issues identified and corrected"}</li>
<li>{"Recommendations for future improvements"}</li>
</ul>
</div></details></div></section>
<div className="growth-website-proof"><section><h3>{"Why Choose Turf Cleaning Academy?"}</h3>
<h4>{"Website Care From People Who Actually Understand Your Industry."}</h4>
<p>{"Most website maintenance companies simply keep websites running."}</p>
<p>{"At Turf Cleaning Academy, we go further."}</p>
<p>{"We understand artificial turf cleaning, pet odor removal, turf restoration, commercial maintenance, and the questions customers ask before booking a service."}</p>
<p>{"We've built a seven-figure turf cleaning business, and we bring that industry experience into the content, optimization, and ongoing development of your website."}</p>
<p>{"You get more than a website technician. You get a team focused on helping your turf cleaning company build a stronger online presence."}</p>
</section><section><h3>{"Your Website Is an Ongoing Investment in Your Business"}</h3>
<p>{"Whether you need occasional website changes or complete monthly website management, Turf Cleaning Academy offers flexible services designed around your company's needs."}</p>
<p><strong>{"Keep Your Website Fresh. Improve Your Search Visibility. Expand Your Service Areas. Build Your Online Authority."}</strong></p>
</section></div>
<section className="growth-care-plan" id="website-care-plan" aria-labelledby="website-care-plan-title"><div><span className="growth-seo-eyebrow">Optional monthly service</span><h3 id="website-care-plan-title">Website Care Plan</h3><p>Your proposal confirms the work included each month, content quantities, turnaround, and any separately priced work.</p><p>No plan is added until you review the scope and complete checkout for an agreed quote.</p></div><div className="growth-care-plan-price"><span>Starting at</span><strong>{price(service.fromCents)}{service.toCents !== service.fromCents && `–${price(service.toCents)}`}</strong><span>{service.billingInterval === "month" ? "per month" : service.billingInterval === "one_time" ? "one-time" : "Billing confirmed in your proposal"}</span>{!readOnly && <a className="primary-button" href={`#${requestId}`}>Discuss My Care Plan <ArrowRight size={17} aria-hidden="true" /></a>}</div></section>
<section className="growth-website-ready"><h4>{"Ready to Take Your Website to the Next Level?"}</h4>
<p>{"Let our team handle your website updates, SEO improvements, new content, and ongoing maintenance."}</p>
</section>
</div>; }
