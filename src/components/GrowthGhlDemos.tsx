import { useState } from "react";
import { ArrowRight, BarChart3, GitBranch, MessageSquare } from "lucide-react";

const stages = ["New leads", "Contacted", "Quote sent", "Follow-up", "Scheduled", "Completed"];
const residential = [{ title: "Residential pet turf", area: "500 sq. ft.", stage: 0 }, { title: "Putting green cleaning", area: "1,200 sq. ft.", stage: 2 }];
const commercial = [{ title: "Commercial dog park", area: "8,000 sq. ft.", stage: 0 }, { title: "Apartment pet area", area: "3,500 sq. ft.", stage: 3 }];
const branches = {
  "Customer responds": "Pause generic follow-ups and route the conversation to approved AI assistance or a team member.",
  "No response": "Wait for the agreed interval, then use permitted follow-ups within the contact’s preferences.",
  "Appointment booked": "End estimate follow-ups and move to confirmations and appointment reminders.",
  "Customer declines": "Update the opportunity and stop the sales sequence. Honor opt-outs across connected workflows.",
  "Staff needed": "Pause automated answers and notify a team member for a human handoff.",
};
const conversations = {
  "AI qualification": [
    ["Customer", "Hi, I need my artificial turf cleaned. I have three dogs."],
    ["Assistant", "Absolutely! Approximately how many square feet of artificial turf do you have?"],
    ["Customer", "About 600 square feet."],
    ["Assistant", "Thanks! Are you mainly looking for routine cleaning, pet odor removal, or a deeper turf restoration service?"],
    ["Customer", "Pet odor removal."],
    ["Assistant", "Got it. I can help collect the information needed for a quote. What city is the property located in?"],
  ],
  "SMS follow-up": [
    ["Business", "Hi, just checking in to see if you had any questions about the turf cleaning estimate we sent over."],
    ["Customer", "I’m still thinking about it."],
    ["Business", "Of course. Is there anything specific you’re weighing, such as the cleaning process, expected results, or the price?"],
    ["Customer", "Mostly the price."],
    ["Business", "That makes sense. Would it help if I explained what’s included in the service and how it differs from a basic spray treatment?"],
  ],
};

export function GrowthGhlDemos() {
  const [pipeline, setPipeline] = useState<"Residential" | "Commercial">("Residential");
  const [moves, setMoves] = useState<Record<string, number>>({});
  const [branch, setBranch] = useState<keyof typeof branches>("Customer responds");
  const [conversation, setConversation] = useState<keyof typeof conversations>("AI qualification");
  const [visibleMessages, setVisibleMessages] = useState(2);
  const [period, setPeriod] = useState<30 | 60 | 90>(30);
  const leads = pipeline === "Residential" ? residential : commercial;
  const multiplier = period / 30;
  return <section className="growth-ghl-demos" aria-labelledby="ghl-demos-title">
    <h3 id="ghl-demos-title">Explore How Your System Could Work</h3>
    <p className="growth-ghl-demo-label">Interactive examples with fictional data. These demos do not send messages, book appointments, or connect to customer records.</p>
    <section className="growth-ghl-panel" aria-labelledby="ghl-pipeline-title"><header><h4 id="ghl-pipeline-title">Organize Every Opportunity</h4><div className="growth-ghl-switch" role="group" aria-label="Example sales pipeline">{(["Residential", "Commercial"] as const).map(value => <button type="button" key={value} aria-pressed={pipeline === value} onClick={() => setPipeline(value)}>{value}</button>)}</div></header>
      <p>Move a fictional opportunity through the stages to explore the pipeline.</p>
      <div className="growth-ghl-pipeline">{stages.map((stage, index) => <section key={stage} aria-label={stage}><h5>{stage}</h5>{leads.filter(lead => (moves[lead.title] ?? lead.stage) === index).map(lead => <article key={lead.title}><strong>{lead.title}</strong><span>{lead.area}</span><small>Assigned to: Sample team</small>{index < stages.length - 1 && <button type="button" className="growth-text-button" onClick={() => setMoves(current => ({ ...current, [lead.title]: index + 1 }))} aria-label={`Move ${lead.title} to ${stages[index + 1]}`}>Next stage <ArrowRight size={14} aria-hidden="true" /></button>}</article>)}</section>)}</div><button className="growth-text-button" type="button" onClick={() => setMoves({})}>Reset example pipeline</button>
    </section>

    <div className="growth-website-proof">
      <section><h3><GitBranch size={21} aria-hidden="true" /> From Lead to Next Booking</h3><ol className="growth-ghl-workflow"><li>Capture contact and opportunity</li><li>Assign a team member and call task</li><li>Send permitted acknowledgment</li><li>Handle questions and prepare a quote</li><li>Confirm a real calendar booking</li><li>Complete service and offer follow-up</li></ol><label className="growth-ghl-field">Explore a workflow branch<select value={branch} onChange={event => setBranch(event.target.value as keyof typeof branches)}>{Object.keys(branches).map(value => <option key={value}>{value}</option>)}</select></label><p className="growth-ghl-branch" aria-live="polite">{branches[branch]}</p></section>
      <section><h3><MessageSquare size={21} aria-hidden="true" /> Helpful Conversations</h3><div className="growth-ghl-switch" role="group" aria-label="Example conversation">{Object.keys(conversations).map(value => <button type="button" key={value} aria-pressed={conversation === value} onClick={() => { setConversation(value as keyof typeof conversations); setVisibleMessages(2); }}>{value}</button>)}</div><div className="growth-ghl-messages" aria-live="polite">{conversations[conversation].slice(0, visibleMessages).map(([speaker, message], index) => <p className={speaker === "Customer" ? "customer" : "assistant"} key={`${conversation}-${index}`}><strong>{speaker}</strong>{message}</p>)}</div><div className="growth-seo-actions"><button className="secondary-button" type="button" disabled={visibleMessages >= conversations[conversation].length} onClick={() => setVisibleMessages(current => current + 1)}>Show next message</button><button className="growth-text-button" type="button" onClick={() => setVisibleMessages(2)}>Replay</button></div><p className="growth-quote-note">Scripted examples. No live AI, SMS delivery, pricing, or booking is performed.</p></section>
    </div>

    <section className="growth-ghl-panel" aria-labelledby="ghl-reporting-title"><header><h4 id="ghl-reporting-title"><BarChart3 size={21} aria-hidden="true" /> Track Leads, Follow-Ups &amp; Sales Activity</h4><div className="growth-ghl-switch" role="group" aria-label="Example reporting period">{([30, 60, 90] as const).map(value => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value} days</button>)}</div></header><p className="growth-seo-sample-label">Illustrative dashboard — not actual client performance</p><div className="growth-ghl-metrics"><div><strong>{24 * multiplier}</strong><span>Sample leads</span></div><div><strong>{15 * multiplier}</strong><span>Sample quotes</span></div><div><strong>{9 * multiplier}</strong><span>Sample bookings</span></div><div><strong>{20 * multiplier}</strong><span>Completed follow-ups</span></div></div><svg className="growth-ghl-chart" viewBox="0 0 600 110" role="img" aria-label={`Illustrative lead activity chart for ${period} days; no real performance data`}><line x1="0" y1="100" x2="600" y2="100" stroke="currentColor" opacity=".2" />{[6, 12, 9, 18, 15, 24, 20, 28, 22, 32, 26, 36].map((value, index) => <rect key={index} x={index * 50 + 8} y={100 - value * (1.3 + multiplier / 3)} width="30" height={value * (1.3 + multiplier / 3)} rx="4" fill="currentColor"><title>Example period {index + 1}: {Math.round(value * multiplier)} activity units</title></rect>)}</svg><p className="growth-quote-note">Example activity units illustrate a dashboard layout. Metrics and attribution depend on the data available in your configured system.</p></section>
    <section className="growth-website-package"><h3>Keep the Customer Relationship Going</h3><ol className="growth-seo-funnel"><li>Service completed</li><li>Review request</li><li>30-day check-in</li><li>60-day reminder</li><li>90-day rebooking option</li></ol><p>Reminder timing is configurable around service history, customer preferences, and your agreed campaigns.</p></section>
  </section>;
}
