import { ArrowRight, BarChart3, BookOpen, BrainCircuit, CheckCircle2, ChevronDown, ClipboardCheck, Code2, FileSearch, Globe, MapPin, MessageSquare, MousePointerClick, Search, Target, TrendingUp } from "lucide-react";

const sections = [
  { title: "Complete Website SEO Audit", icon: FileSearch, description: "Find the technical issues, content gaps, and missed search opportunities on your current website.", items: ["Keyword ranking and search visibility review", "Website architecture and technical SEO audit", "Content, mobile usability, and indexing evaluation", "Competitor and conversion review"] },
  { title: "Industry-Specific Keyword Research", icon: Target, description: "Focus on the words customers use when they need residential or commercial turf cleaning.", items: ["Artificial turf cleaning and turf cleaning near me", "Pet turf cleaning and artificial grass odor removal", "Turf restoration and commercial turf cleaning", "Gym turf cleaning and putting green cleaning", "Local keyword research for your actual service areas"] },
  { title: "On-Page SEO Optimization", icon: Code2, description: "Give each page a clear purpose, useful content, and a stronger structure.", items: ["Page titles, meta descriptions, and heading structure", "Natural keyword use and clearer service content", "Internal links, image optimization, and descriptive URLs", "Calls to action that help visitors take the next step"] },
  { title: "Local SEO & Service Areas", icon: MapPin, description: "Connect your services with the cities and communities you actually serve.", items: ["City-specific keyword research and service-area content", "Google Business Profile recommendations", "Consistent business names, contact details, and service information", "Relevant LocalBusiness and Service structured data", "Unique, useful location pages rather than duplicate city content"] },
  { title: "AEO & AI Search Optimization", icon: BrainCircuit, description: "Make your business information and helpful answers easier for AI-assisted search systems to understand.", items: ["Conversational questions and informative answers", "Clear explanations of services, methods, and service areas", "Consistent business facts and relevant structured data", "Helpful educational information grounded in your expertise", "Visibility observations across AI-assisted search where measurable"] },
  { title: "Educational Content & Guides", icon: BookOpen, description: "Answer the questions customers ask before they choose a turf cleaning company.", items: ["Review existing guides and identify useful new topics", "Dog urine odors, turf care, and cleaning frequency", "Professional versus DIY cleaning", "Infill, drainage, and commercial turf maintenance", "New guides and additional pages are scoped and priced separately when needed"] },
  { title: "Technical SEO & Performance", icon: Globe, description: "Review the foundation that helps search engines discover, understand, and index your pages.", items: ["XML sitemaps, robots.txt, and indexing settings", "Canonical URLs, redirects, and broken links", "Core Web Vitals, image optimization, and mobile performance", "Structured data validation against visible page content", "Google Search Console and analytics configuration"] },
  { title: "Competitor Research", icon: Search, description: "Understand how other turf cleaning businesses serve customers in your market.", items: ["Local search competitors and relevant keyword coverage", "Content gaps and service-area opportunities", "Website architecture and service-page comparisons", "Relevant local mentions and backlink opportunities"] },
  { title: "Conversion Optimization", icon: MousePointerClick, description: "Help visitors move from reading about your services to requesting a quote.", items: ["Quote forms and mobile click-to-call buttons", "Clear service explanations and calls to action", "Placement of genuine testimonials and trust signals", "Mobile conversion improvements and lead tracking"] },
  { title: "Performance Tracking & Reporting", icon: BarChart3, description: "Use available data to understand your starting point and guide the next improvements.", items: ["Organic traffic, search impressions, and keyword trends", "Website inquiries, conversions, and useful lead measures", "Top-performing pages and completed technical improvements", "AI search observations where measurable", "Reporting frequency and ongoing recommendations are agreed in your proposal"] },
];
const process = [
  { title: "Analyze", icon: FileSearch, text: "Review your website, services, competition, and market." },
  { title: "Plan", icon: Target, text: "Agree on a practical SEO and AEO plan for your business." },
  { title: "Optimize", icon: Code2, text: "Improve the content, structure, and technical foundation." },
  { title: "Measure", icon: TrendingUp, text: "Review available results and identify the next opportunities." },
];
const sampleFindings = ["Page descriptions need attention", "Service pages could answer more customer questions", "Internal links need improvement", "Business details need consistency"];

export function GrowthSeoContent({ requestId, readOnly = false }: { requestId: string; readOnly?: boolean }) {
  return <div className="growth-marketing-body growth-service-description growth-seo-content">
    <header className="growth-website-intro">
      <span className="growth-seo-eyebrow">Marketing built for the turf cleaning industry</span>
      <h2>SEO &amp; AEO Optimization for Turf Cleaning Companies</h2>
      <h4>Get Found on Google. Get Discovered Through AI. Generate More Turf Cleaning Leads.</h4>
      <p>Your customers are searching for turf cleaning services. Whether they search Google for a local company or ask an AI-powered tool about turf care, your website needs a clear, helpful foundation to compete.</p>
      <p>At <strong>Turf Cleaning Academy</strong>, we provide SEO and AEO services developed specifically for the turf cleaning industry. We understand the services, customers, and questions that matter to your business.</p>
      <div className="growth-seo-actions">{!readOnly && <a className="primary-button" href={`#${requestId}`}>Request My SEO &amp; AEO Review <ArrowRight size={17} aria-hidden="true" /></a>}<a className="secondary-button" href="#seo-package-title">Explore Our Services <ChevronDown size={17} aria-hidden="true" /></a></div>
      <div className="growth-website-highlights"><span><strong>Local search</strong> visibility</span><span><strong>AI-assisted</strong> discovery</span><span><strong>Better paths</strong> to inquiries</span></div>
    </header>

    <figure className="growth-seo-overview">
      <figcaption><strong>SEO &amp; AEO Overview — Illustrative Example</strong><p>The chart figures shown are examples, not verified client results or guaranteed improvements.</p></figcaption>
      <a href="/images/seo-aeo-overview.png" target="_blank" rel="noopener noreferrer" aria-label="View full SEO and AEO overview image"><img src="/images/seo-aeo-overview.png" alt="SEO and AEO service overview with example growth charts, service categories, search platforms, and a four-step process." width={1536} height={1024} loading="lazy" decoding="async" /></a>
    </figure>

    <section className="growth-seo-search" aria-labelledby="seo-search-title">
      <h3 id="seo-search-title">One Website. Two Important Search Opportunities.</h3>
      <p>We optimize your website for traditional search engines and AI-powered discovery.</p>
      <div className="growth-website-proof">
        <section><h3><Search size={21} aria-hidden="true" /> Traditional SEO — Google &amp; Bing</h3><p>Help search engines crawl, understand, and index useful pages about your turf cleaning services.</p><div className="growth-seo-search-mock"><span className="growth-seo-sample-label">Illustrative search example</span><div className="growth-seo-query"><Search size={16} aria-hidden="true" /> Artificial turf cleaning near me</div><strong>Your Turf Cleaning Company</strong><span>Professional turf cleaning in your service area</span><p>Clear service information, helpful answers, and a simple way to request a quote.</p></div></section>
        <section><h3><MessageSquare size={21} aria-hidden="true" /> AEO — AI-Powered Search</h3><p>Make your business information and expertise easier to interpret through clear, useful content.</p><div className="growth-seo-search-mock"><span className="growth-seo-sample-label">Illustrative AI conversation</span><div className="growth-seo-query">Who provides professional turf cleaning in my area?</div><p>Look for a local provider that explains its cleaning methods, service areas, and experience. Check its services and request a quote for your property.</p></div></section>
      </div>
      <p className="growth-quote-note">AI-assisted discovery can include Google AI experiences, ChatGPT Search, Gemini, Perplexity, and Bing. Examples above are mockups, not actual search results or recommendations.</p>
    </section>

    <section className="growth-website-package" aria-labelledby="seo-package-title">
      <h3 id="seo-package-title">Complete SEO &amp; AEO Services</h3>
      <p>Explore the work we can address. Your proposal confirms the scope, priorities, and reporting schedule for your website.</p>
      <div className="growth-package-options growth-seo-service-grid">{sections.map(section => {
        const Icon = section.icon;
        return <details className="growth-package-option" key={section.title}>
          <summary><span className="growth-package-number"><Icon size={21} aria-hidden="true" /></span><span className="growth-seo-service-heading"><h4>{section.title}</h4><span>{section.description}</span></span><ChevronDown size={20} aria-hidden="true" /></summary>
          <div className="growth-package-content"><ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul></div>
        </details>;
      })}</div>
    </section>

    <section className="growth-website-package" aria-labelledby="seo-process-title">
      <h3 id="seo-process-title">A Clear Process From Review to Improvement</h3>
      <div className="growth-seo-process">{process.map((step, index) => {
        const Icon = step.icon;
        return <article key={step.title}><span className="growth-seo-process-step">0{index + 1}<Icon size={23} aria-hidden="true" /></span><h4>{step.title}</h4><p>{step.text}</p></article>;
      })}</div>
    </section>

    <section className="growth-seo-audit" aria-labelledby="seo-audit-title">
      <div><ClipboardCheck size={30} aria-hidden="true" /><h3 id="seo-audit-title">See What’s Holding Your Website Back</h3><p>A review can connect technical issues, content gaps, local business information, and AI search readiness into a practical plan.</p><p><strong>Start with your website. Focus on what matters to your market.</strong></p></div>
      <div className="growth-seo-audit-sample"><span className="growth-seo-sample-label">Sample SEO audit — illustrative findings</span><ul>{sampleFindings.map(item => <li key={item}><ClipboardCheck size={16} aria-hidden="true" />{item}</li>)}</ul><p>This is an example checklist, not an audit of your website.</p></div>
    </section>

    <section className="growth-website-package" aria-labelledby="seo-path-title"><h3 id="seo-path-title">From Online Searches to Customer Conversations</h3><ol className="growth-seo-funnel"><li>Search or AI discovery</li><li>A useful website visit</li><li>A quote request</li><li>Your follow-up</li><li>A potential booking</li></ol></section>

    <div className="growth-website-proof">
      <section><h3>Built by Turf Cleaning Professionals</h3><p>Turf Cleaning Academy was founded by pioneers in professional turf cleaning who have built a seven-figure turf cleaning business.</p><p>We bring industry experience to the way we explain your services, understand your customers, and plan useful content for your market.</p></section>
      <section><h3>Already Getting a New Website?</h3><p>Our complete website package already includes an SEO and AEO foundation.</p><p>This separate service can address an existing website or work beyond your website package. We’ll confirm what is already included before preparing your quote. New guides, additional pages, and ongoing work are scoped separately when needed.</p></section>
    </div>
    <div className="growth-seo-outcomes"><span><CheckCircle2 size={18} aria-hidden="true" /> Clearer service content</span><span><CheckCircle2 size={18} aria-hidden="true" /> Stronger search foundations</span><span><CheckCircle2 size={18} aria-hidden="true" /> Better conversion opportunities</span></div>
    <section className="growth-website-ready"><h4>Ready to Improve Your Search Presence?</h4><p>Tell us about your website, the services you provide, and the cities you serve. We’ll review your needs and confirm the scope and price before any payment.</p><p><strong>Build a clearer path from customer questions to your turf cleaning business.</strong></p></section>
    <p className="growth-quote-note">Results depend on market competition, website quality, implementation, and time. Search engines and AI platforms decide what they display; rankings, citations, recommendations, leads, and revenue are not guaranteed.</p>
  </div>;
}
