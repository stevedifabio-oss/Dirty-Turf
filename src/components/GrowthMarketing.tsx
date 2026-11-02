import { ArrowRight, Globe } from "lucide-react";

export function GrowthMarketing({ servicesId }: { servicesId: string }) {
  return <section className="growth-marketing" aria-labelledby={`${servicesId}-intro`}>
    <header className="growth-intro"><div><h2 id={`${servicesId}-intro`}>Grow your business.</h2></div><span className="growth-intro-mark" aria-hidden="true"><Globe size={28} /></span></header>
    <div className="growth-marketing-body">
      <h3>Grow Your Turf Cleaning Company With Proven Marketing Strategies</h3>
      <p><strong>Learn from the pioneers of the turf cleaning industry and take your business to the next level.</strong></p>
      <p>At Turf Cleaning Academy, we don't just teach turf cleaning — we teach you how to build, market, and grow a successful turf cleaning business.</p>
      <p>As pioneers in the professional turf cleaning industry, we've built a <strong>seven-figure turf cleaning company</strong> and developed marketing strategies specifically designed for this niche. We've spent years testing, refining, and mastering what works, so you don't have to waste time and money figuring it out yourself.</p>
      <p>From professional website development and SEO/AEO optimization to Facebook advertising, GoHighLevel CRM systems, lead generation, and automated customer follow-ups, we understand what it takes to attract customers, generate leads, and turn those leads into booked jobs.</p>
      <h3>Everything You Need to Market and Grow Your Business</h3>
      <ul className="growth-marketing-capabilities">
        <li><strong>Website Design &amp; Development</strong> – Professional, high-converting websites built specifically for turf cleaning companies.</li>
        <li><strong>SEO &amp; AEO Optimization</strong> – Help your business get discovered through Google and AI-powered search.</li>
        <li><strong>Facebook &amp; Instagram Advertising</strong> – Targeted advertising campaigns designed to generate residential and commercial turf cleaning leads.</li>
        <li><strong>GoHighLevel Setup &amp; Automation</strong> – CRM systems, automated follow-ups, lead management, appointment scheduling, and customer retention tools.</li>
        <li><strong>Website Maintenance &amp; Updates</strong> – Keep your website fresh, professional, and optimized for conversions.</li>
        <li><strong>GoHighLevel Management</strong> – Let our team manage and optimize your CRM, workflows, and marketing automations.</li>
      </ul>
      <h3>Built by Turf Cleaning Professionals, for Turf Cleaning Professionals</h3>
      <p>Unlike traditional marketing agencies, we actually operate in the turf cleaning industry. We understand your customers, your services, your competition, and the challenges of growing a turf cleaning company.</p>
      <p><strong>We've built a seven-figure business using these strategies. Now we're making our experience, systems, and marketing services available to help you grow yours.</strong></p>
      <p>Whether you're just starting out or looking to scale an established operation, Turf Cleaning Academy gives you access to the tools, knowledge, and marketing support to grow with confidence.</p>
      <p><strong>Stop guessing at marketing. Start building your turf cleaning business with strategies developed from real industry experience.</strong></p><a className="growth-text-button" href={`#${servicesId}`}>Explore Our Marketing Services <ArrowRight size={18} aria-hidden="true" /></a>
    </div>
  </section>;
}
