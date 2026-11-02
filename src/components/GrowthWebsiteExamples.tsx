import { useRef, useState } from "react";
import { Expand, X } from "lucide-react";
import { useModalDialog } from "../lib/useModalDialog";

const examples = [
  { file: "dirty-turf-classic.png", title: "Dirty Turf · Classic", description: "Service cards, cleaning process, and a quote form." },
  { file: "dirty-turf-lead-focused.png", title: "Dirty Turf · Lead focused", description: "A prominent quote form and clear service sections." },
  { file: "turf-clean-light.png", title: "Turf Clean · Light", description: "A bright layout with service cards and spacious sections." },
  { file: "turf-pros-dark.png", title: "Turf Pros · Dark", description: "A dark layout with bold green and blue accents." },
  { file: "dirty-turf-modern.png", title: "Dirty Turf · Modern", description: "A bold layout with quote forms, service cards, and results sections." },
  { file: "dirty-turf-premium.png", title: "Dirty Turf · Premium", description: "An elegant layout with a sunset hero, service cards, and clear quote forms." },
] as const;
type Example = typeof examples[number];
const imagePath = (example: Example) => `/images/website-examples/${example.file}`;

function ExamplePreview({ example, onClose }: { example: Example; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(dialogRef, onClose);
  return <div className="growth-example-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="growth-example-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${example.title} website example`}>
      <header><div><h3>{example.title}</h3><p>Example website design</p></div><button type="button" className="icon-button" data-dialog-autofocus aria-label="Close website example" onClick={onClose}><X size={22} /></button></header>
      <div className="growth-example-full"><img src={imagePath(example)} alt={`Full ${example.title} website design`} /></div>
    </section>
  </div>;
}

export function GrowthWebsiteExamples() {
  const [selected, setSelected] = useState<Example | null>(null);
  return <section className="growth-website-examples" aria-labelledby="website-examples-title">
    <h3 id="website-examples-title">Explore Example Website Designs</h3>
    <p>A few possible directions for your website. Your final design is customized to your brand, services, and market. Select an example to view the full design.</p>
    <div className="growth-website-example-grid">{examples.map(example => <button type="button" className="growth-website-example" key={example.file} onClick={() => setSelected(example)} aria-label={`View ${example.title} website example`}>
      <span className="growth-example-thumbnail"><img src={imagePath(example)} alt="" loading="lazy" decoding="async" /><span><Expand size={17} /> View full design</span></span>
      <span className="growth-example-caption"><strong>{example.title}</strong><span>{example.description}</span></span>
    </button>)}</div>
    {selected && <ExamplePreview example={selected} onClose={() => setSelected(null)} />}
  </section>;
}
