import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarDays,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Crosshair,
  Home,
  ImagePlus,
  Map,
  MapPin,
  Package,
  Plus,
  Ruler,
  Search,
  Send,
  Settings2,
  Sparkles,
  Smartphone,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { Job, MeasurementMode, QuoteDraft, QuoteTotals } from "./domain";
import { getDataMode, loadJobs, requestMagicLink, signOut, type DataMode, saveJob } from "./lib/backend";
import { buildAcademyUrl, consumeAcademySessionKey } from "./lib/academyLinks";
import { hasNativeLiveMeasurement, startNativeLiveMeasurement } from "./lib/liveMeasurement";
import { calculateQuote } from "./lib/quote";
import { GhlPortalView } from "./components/GhlPortal";
import { MapMeasurement } from "./components/MapMeasurement";
import { HubSheet, type HubSection } from "./components/Network";
import "./styles.css";

type View = "home" | "learn" | "community" | "events" | "tools";

const initialJobs: Job[] = [
  { id: 1, address: "Mesa backyard", area: 684, infill: 5, quote: 492.48, status: "Calculated", method: "camera", createdAt: "Today", photos: 4 },
  { id: 2, address: "Scottsdale side yard", area: 312, infill: 2, quote: 224.64, status: "Calculated", method: "map", createdAt: "Yesterday", photos: 0 },
  { id: 3, address: "Chandler dog run", area: 148, infill: 1, quote: 106.56, status: "Calculated", method: "manual", createdAt: "Sep 12", photos: 6 },
];

const INFILL_RATES = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3] as const;

const defaultDraft: QuoteDraft = {
  address: "",
  mode: "camera",
  length: 38,
  width: 18,
  cameraArea: 684,
  mapArea: 684,
  serviceRate: 0.72,
  infillRate: 0.25,
};

const navTitles: Record<View, string> = {
  home: "Field dashboard",
  learn: "Academy",
  community: "Community",
  events: "Live calendar",
  tools: "Operator tools",
};

function App() {
  const [academySessionKey] = useState(() => consumeAcademySessionKey());
  const [activeView, setActiveView] = useState<View>("home");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hubSection, setHubSection] = useState<HubSection | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState<QuoteDraft>(defaultDraft);
  const [photoUrl, setPhotoUrl] = useState("");
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [dataMode, setDataMode] = useState<DataMode>("device");
  const courseLibraryUrl = buildAcademyUrl("courses", academySessionKey);
  const communityUrl = buildAcademyUrl("community", academySessionKey);
  const eventsUrl = buildAcademyUrl("events", academySessionKey);

  useEffect(() => {
    Promise.all([loadJobs(initialJobs), getDataMode()])
      .then(([loadedJobs, mode]) => {
        setJobs(loadedJobs.length ? loadedJobs : initialJobs);
        setDataMode(mode);
      })
      .catch(() => setToast("Cloud data is unavailable. Working on this device."));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const quote = calculateQuote(draft);

  const openQuote = (mode: MeasurementMode = "camera") => {
    setDraft((current) => ({ ...current, mode }));
    setQuoteOpen(true);
  };

  const saveQuote = async () => {
    if (quote.area <= 0) {
      setToast("Measure or enter a turf area first.");
      return;
    }
    const job: Job = {
      id: Date.now(),
      address: draft.address.trim() || "Infill calculation",
      area: quote.area,
      infill: quote.bags40,
      quote: quote.total,
      status: "Calculated",
      method: draft.mode,
      createdAt: "Just now",
      photos: photoUrl ? 1 : 0,
    };
    try {
      const savedJob = await saveJob(job, "quick");
      setJobs((current) => [savedJob, ...current.filter((item) => item.id !== savedJob.id)]);
      setQuoteOpen(false);
      setActiveView("home");
      setToast(dataMode === "cloud" ? "Calculation synced to the company workspace." : "Calculation saved on this device.");
    } catch {
      setToast("Calculation could not be saved. Check the connection and try again.");
    }
  };

  const changeView = (view: View) => {
    setActiveView(view);
    setSearchOpen(false);
    setQuery("");
    document.querySelector(".phone-frame")?.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const sendMagicLink = async (email: string) => {
    try {
      const { error } = await requestMagicLink(email);
      if (error) throw error;
      setToast("Magic link sent. Check the client inbox.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Magic link could not be sent.");
    }
  };
  const handleSignOut = async () => {
    await signOut();
    setDataMode("device");
    setHubSection(null);
    setToast("Signed out of the workspace.");
  };

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="Dirty Turf Academy mobile app">
        <header className="topbar">
          <div className="brand-lockup">
            <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
            <div><h1>{navTitles[activeView]}</h1><button className={`data-mode ${dataMode}`} onClick={() => setHubSection(dataMode === "cloud" ? "settings" : "access")}>{dataMode === "cloud" ? "Workspace synced" : "Device preview"}</button></div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" aria-label="Open live HighLevel community notifications" onClick={() => changeView("community")}><Bell size={18} /></button>
            <button className={searchOpen ? "icon-button active" : "icon-button"} aria-label={searchOpen ? "Close search" : "Search"} onClick={() => setSearchOpen((open) => !open)}>{searchOpen ? <X size={19} /> : <Search size={19} />}</button>
            <button className="profile-button" aria-label="Open workspace menu" onClick={() => setHubSection("settings")}>DT</button>
          </div>
        </header>

        {searchOpen && <SearchPanel query={query} setQuery={setQuery} jobs={jobs} onOpenJob={() => openQuote("manual")} onNavigate={changeView} />}
        {!searchOpen && activeView === "home" && <HomeView jobs={jobs} openQuote={openQuote} changeView={changeView} />}
        {!searchOpen && activeView === "tools" && <ToolsView draft={draft} quote={quote} openQuote={openQuote} setToast={setToast} />}
        {!searchOpen && activeView === "learn" && <GhlPortalView kind="courses" url={courseLibraryUrl} />}
        {!searchOpen && activeView === "community" && <GhlPortalView kind="community" url={communityUrl} />}
        {!searchOpen && activeView === "events" && <GhlPortalView kind="events" url={eventsUrl} />}

        <footer className="bottom-nav" aria-label="App sections">
          <NavItem icon={<Home size={20} />} label="Home" active={activeView === "home"} onClick={() => changeView("home")} />
          <NavItem icon={<BookOpen size={20} />} label="Learn" active={activeView === "learn"} onClick={() => changeView("learn")} />
          <NavItem icon={<Users size={20} />} label="Community" active={activeView === "community"} onClick={() => changeView("community")} />
          <NavItem icon={<CalendarDays size={20} />} label="Events" active={activeView === "events"} onClick={() => changeView("events")} />
          <NavItem icon={<Wrench size={20} />} label="Tools" active={activeView === "tools"} onClick={() => changeView("tools")} />
        </footer>

        {quoteOpen && <QuoteSheet draft={draft} setDraft={setDraft} quote={quote} photoUrl={photoUrl} setPhotoUrl={setPhotoUrl} onClose={() => setQuoteOpen(false)} onSave={saveQuote} />}
        {hubSection && <HubSheet section={hubSection} onClose={() => setHubSection(null)} onToast={setToast} onRequestMagicLink={sendMagicLink} onSignOut={handleSignOut} dataMode={dataMode} />}
        {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
      </section>

      <aside className="strategy-panel">
        <p className="kicker">Product direction</p>
        <h2>The Dirty Turf standard, in every operator's pocket.</h2>
        <p className="strategy-intro">Learn the process, measure the property, calculate the right infill, and keep the complete service record with the company.</p>
        <div className="product-loop" aria-label="Product workflow">
          <LoopStep icon={<BookOpen size={19} />} title="Learn" detail="GHL course library" />
          <LoopStep icon={<Ruler size={19} />} title="Measure" detail="Camera, map, or manual" />
          <LoopStep icon={<Calculator size={19} />} title="Quote" detail="Quick, Premium, or Annihilator" />
          <LoopStep icon={<Users size={19} />} title="Share" detail="Operator feedback" />
        </div>
        <div className="release-note"><Sparkles size={20} /><div><strong>{dataMode === "cloud" ? "Cloud workspace connected" : "Backend-ready device mode"}</strong><p>Supabase sync, private photo storage, live AR bridges, and current or historical property imagery are ready for the client connections.</p></div></div>
      </aside>
    </main>
  );
}

function HomeView({ jobs, openQuote, changeView }: { jobs: Job[]; openQuote: (mode: MeasurementMode) => void; changeView: (view: View) => void }) {
  const latest = jobs[0];
  return (
    <div className="view-content">
      <section className="field-hero">
        <div className="field-text"><p>Dirty Turf operator</p><h2>Measure the turf. Bring the right amount of infill.</h2><button className="hero-action" onClick={() => openQuote("camera")}><Camera size={17} /> Start measurement</button></div>
        <div className="field-scanner" aria-hidden="true"><div className="scanner-grid" /><div className="scanner-chip">{latest.area} sq ft</div><div className="scanner-pin one" /><div className="scanner-pin two" /><div className="scanner-pin three" /></div>
      </section>

      <nav className="quick-actions" aria-label="Primary tools">
        <Action icon={<Camera size={20} />} label="Camera measure" onClick={() => openQuote("camera")} />
        <Action icon={<Map size={20} />} label="Map trace" onClick={() => openQuote("map")} />
        <Action icon={<Package size={20} />} label="Infill calculator" onClick={() => openQuote("manual")} />
        <Action icon={<BookOpen size={20} />} label="Academy" onClick={() => changeView("learn")} />
      </nav>

      <section className="tool-panel">
        <div className="section-heading"><div><p>Latest calculation</p><h3>{latest.address}</h3></div><button className="ghost-button" onClick={() => openQuote("manual")}>New <Plus size={16} /></button></div>
        <div className="quote-grid"><Metric label="Area" value={formatNumber(latest.area)} suffix="sq ft" /><Metric label="40-lb" value={String(latest.infill)} suffix="bags" /><Metric label="Service" value={formatCurrency(latest.quote)} suffix="at sq-ft rate" /></div>
        <div className="quote-line"><Ruler size={18} /><span>{measurementLabel(latest.method)} saved to calculation history.</span><Check size={18} /></div>
      </section>

      <section className="history-strip">
        <div className="section-heading compact"><div><p>Site history</p><h3>Photos by visit</h3></div><button className="bare-icon" aria-label="View all site photos"><ChevronRight size={18} /></button></div>
        <div className="photo-row" aria-label="Past turf photos"><div className="photo-tile spring"><span>Today</span><small>After service</small></div><div className="photo-tile summer"><span>2025</span><small>Infill refresh</small></div><div className="photo-tile winter"><span>2024</span><small>First visit</small></div></div>
      </section>

      <section className="academy-preview">
        <div className="section-heading"><div><p>Academy</p><h3>Continue in the live course library</h3></div><button className="text-button" onClick={() => changeView("learn")}>Open</button></div>
        <button className="academy-live-link" onClick={() => changeView("learn")}><span><BookOpen size={18} /></span><span><strong>Dirty Turf Academy</strong><small>Your courses and progress stay synced in HighLevel.</small></span><ChevronRight size={17} /></button>
      </section>

      <section className="network-strip">
        <div className="section-heading"><div><p>Your network</p><h3>Operator community</h3></div><Users size={18} /></div>
        <div className="network-actions"><button onClick={() => changeView("community")}><Users size={18} /><span><strong>Member community</strong><small>Open discussions</small></span><ChevronRight size={16} /></button><button onClick={() => changeView("events")}><CalendarDays size={18} /><span><strong>Live events</strong><small>View the calendar</small></span><ChevronRight size={16} /></button></div>
      </section>

      <section className="jobs"><div className="section-heading"><div><p>Pipeline</p><h3>Recent properties</h3></div><ClipboardList size={18} /></div>{jobs.slice(0, 4).map((job) => <JobRow job={job} key={job.id} />)}</section>
    </div>
  );
}

function ToolsView({ draft, quote, openQuote, setToast }: { draft: QuoteDraft; quote: QuoteTotals; openQuote: (mode: MeasurementMode) => void; setToast: (message: string) => void }) {
  const [checks, setChecks] = useState([false, false, false, false]);
  const checklist = ["Photograph problem areas", "Check seams and edges", "Confirm water access", "Log infill condition"];
  return (
    <div className="view-content tools-view">
      <section className="tool-lead"><div><p className="kicker">Field kit</p><h2>Measure turf. Bring the right infill.</h2></div><button className="primary-button" onClick={() => openQuote("camera")}><Plus size={18} /> New calculation</button></section>
      <section className="live-estimate"><div className="estimate-total"><span>Infill calculator</span><strong>{quote.bags40} 40-lb bags</strong><small>{formatNumber(quote.infillPounds)} lb at {draft.infillRate.toFixed(2)} lb/sq ft · {formatNumber(quote.area)} sq ft</small></div><button className="edit-estimate" onClick={() => openQuote(draft.mode)} aria-label="Edit infill calculation"><Settings2 size={19} /></button></section>
      <section className="tool-list" aria-label="Measurement tools">
        <ToolRow icon={<Camera size={20} />} title="Live camera measure" detail="Place AR points around the turf boundary" onClick={() => openQuote("camera")} />
        <ToolRow icon={<Map size={20} />} title="Map trace" detail="Outline the turf instead of opening Google Earth" onClick={() => openQuote("map")} />
        <ToolRow icon={<Calculator size={20} />} title="Manual dimensions" detail="Enter length and width for a rectangular area" onClick={() => openQuote("manual")} />
      </section>
      <section className="checklist-panel">
        <div className="section-heading"><div><p>Arrival routine</p><h3>Property checklist</h3></div><span className="completion-count">{checks.filter(Boolean).length}/{checks.length}</span></div>
        {checklist.map((item, index) => <label className={checks[index] ? "check-row done" : "check-row"} key={item}><input type="checkbox" checked={checks[index]} onChange={() => setChecks((current) => current.map((checked, itemIndex) => itemIndex === index ? !checked : checked))} /><span className="custom-check"><Check size={14} /></span><span>{item}</span></label>)}
        <button className="secondary-button" onClick={() => setToast("Checklist saved for this visit.")}><ClipboardCheck size={17} /> Save checklist</button>
      </section>
    </div>
  );
}
function SearchPanel({ query, setQuery, jobs, onOpenJob, onNavigate }: { query: string; setQuery: (query: string) => void; jobs: Job[]; onOpenJob: () => void; onNavigate: (view: View) => void }) {
  const normalized = query.trim().toLowerCase();
  const results = [
    ...jobs.map((job) => ({ type: "Property", title: job.address, detail: `${job.area} sq ft · ${formatCurrency(job.quote)}`, icon: <MapPin size={18} />, action: onOpenJob })),
    { type: "Academy", title: "Live course library", detail: "Open courses, lessons, and progress in HighLevel", icon: <BookOpen size={18} />, action: () => onNavigate("learn") },
    { type: "Community", title: "7 Figure Turf Cleaning", detail: "Open live discussions, members, and leaderboards", icon: <Users size={18} />, action: () => onNavigate("community") },
    { type: "Events", title: "Academy event calendar", detail: "Open live sessions, workshops, and RSVPs", icon: <CalendarDays size={18} />, action: () => onNavigate("events") },
  ].filter((item) => !normalized || `${item.type} ${item.title} ${item.detail}`.toLowerCase().includes(normalized));
  return (
    <section className="search-view"><label className="search-input"><Search size={19} /><span className="sr-only">Search properties and Academy destinations</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search properties and Academy" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button>}</label><p className="result-count">{results.length} {normalized ? "matches" : "destinations and recent properties"}</p><div className="search-results">{results.slice(0, 9).map((item) => <button className="result-row" key={`${item.type}-${item.title}`} onClick={item.action}><span className="result-icon">{item.icon}</span><span><small>{item.type}</small><strong>{item.title}</strong><em>{item.detail}</em></span><ChevronRight size={17} /></button>)}{results.length === 0 && <div className="empty-state"><Search size={24} /><h3>No matches yet</h3><p>Try a saved calculation, Academy, community, or events.</p></div>}</div></section>
  );
}

function QuoteSheet({ draft, setDraft, quote, photoUrl, setPhotoUrl, onClose, onSave }: { draft: QuoteDraft; setDraft: React.Dispatch<React.SetStateAction<QuoteDraft>>; quote: QuoteTotals; photoUrl: string; setPhotoUrl: (url: string) => void; onClose: () => void; onSave: () => void | Promise<void> }) {
  const update = <K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const changePhoto = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) setPhotoUrl(URL.createObjectURL(file)); };
  return (
    <div className="sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="quote-sheet" role="dialog" aria-modal="true" aria-labelledby="quote-title">
        <header className="sheet-header"><button className="bare-icon" aria-label="Close infill calculator" onClick={onClose}><ArrowLeft size={20} /></button><div><p>Field calculator</p><h2 id="quote-title">Infill calculator</h2></div><button className="save-link" onClick={onSave}>Save</button></header>
        <div className="sheet-body">
          <fieldset className="mode-fieldset"><legend>Measurement method</legend><div className="segmented-control"><ModeButton icon={<Camera size={17} />} label="Camera" active={draft.mode === "camera"} onClick={() => update("mode", "camera")} /><ModeButton icon={<Map size={17} />} label="Map" active={draft.mode === "map"} onClick={() => update("mode", "map")} /><ModeButton icon={<Ruler size={17} />} label="Manual" active={draft.mode === "manual"} onClick={() => update("mode", "manual")} /></div></fieldset>
          {draft.mode === "camera" && <LiveCameraMeasurement area={draft.cameraArea} onAreaChange={(value) => update("cameraArea", value)} photoUrl={photoUrl} changePhoto={changePhoto} />}
          {draft.mode === "manual" && <DimensionInputs draft={draft} area={quote.area} update={update} />}
          {draft.mode === "map" && <MapMeasurement address={draft.address} area={draft.mapArea} onAddressChange={(value) => update("address", value)} onAreaChange={(value) => update("mapArea", value)} />}
          <section className="pricing-section"><div className="subheading"><div><p>Material</p><h3>Infill rate</h3></div><Package size={19} /></div><label className="field-label">Pounds per square foot<select value={draft.infillRate} onChange={(event) => update("infillRate", Number(event.target.value))}>{INFILL_RATES.map((rate) => <option key={rate} value={rate}>{rate.toFixed(2)} lb / sq ft</option>)}</select></label><div className="input-grid compact-grid"><NumberField label="Charge per sq ft" value={draft.serviceRate} prefix="$" suffix="/ sq ft" step={0.01} update={(value) => update("serviceRate", value)} /></div></section>
          <section className="quote-summary infill-summary"><div><span>Total turf area</span><strong>{formatNumber(quote.area)} sq ft</strong></div><div><span>Total infill</span><strong>{formatNumber(quote.infillPounds)} lb</strong></div><div><span>40-lb bags</span><strong>{quote.bags40}</strong></div><div><span>50-lb bags</span><strong>{quote.bags50}</strong></div><div className="grand-total"><span>Service charge</span><strong>{formatCurrency(quote.total)}</strong></div></section>
        </div>
        <div className="sheet-footer"><button className="primary-button wide" onClick={onSave}><CheckCircle2 size={18} /> Save calculation</button></div>
      </section>
    </div>
  );
}
function LiveCameraMeasurement({ area, onAreaChange, photoUrl, changePhoto }: { area: number; onAreaChange: (value: number) => void; photoUrl: string; changePhoto: (event: React.ChangeEvent<HTMLInputElement>) => void }) {
  const [nativeAvailable, setNativeAvailable] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    hasNativeLiveMeasurement().then(setNativeAvailable);
  }, []);

  const startMeasure = async () => {
    if (!nativeAvailable) {
      setMessage("Live AR opens from the installed iPhone or Android app.");
      return;
    }
    setMeasuring(true);
    setMessage("");
    try {
      const result = await startNativeLiveMeasurement();
      onAreaChange(Math.round(result.areaSquareFeet));
      setMessage(`${result.points.length} points · ${Math.round(result.perimeterFeet)} ft perimeter`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Live measurement could not start.");
    } finally {
      setMeasuring(false);
    }
  };

  return <div className="capture-panel">
    <section className="ar-measure-card">
      <div className="ar-status"><span><Smartphone size={15} /> Live AR</span><em>{nativeAvailable ? "Ready" : "App build"}</em></div>
      <div className="ar-viewport" aria-hidden="true"><div className="ar-grid" /><Crosshair size={34} /><i className="ar-point point-one" /><i className="ar-point point-two" /><i className="ar-point point-three" /><span>{area > 0 ? `${formatNumber(area)} sq ft` : "Set first point"}</span></div>
      <button type="button" className="primary-button wide" onClick={startMeasure} disabled={measuring}><Crosshair size={18} />{measuring ? "Opening camera..." : "Start live measure"}</button>
      {message && <p className="measure-message" role="status">{message}</p>}
    </section>
    <NumberField label="AR measured area" value={area} suffix="sq ft" update={onAreaChange} />
    <label className={photoUrl ? "capture-box compact has-photo" : "capture-box compact"} style={photoUrl ? { backgroundImage: `linear-gradient(rgba(22, 70, 53, .18), rgba(22, 70, 53, .45)), url(${photoUrl})` } : undefined}><input type="file" accept="image/*" capture="environment" onChange={changePhoto} /><ImagePlus size={20} /><strong>{photoUrl ? "Replace visit photo" : "Add visit photo"}</strong></label>
  </div>;
}

function DimensionInputs({ draft, area, update }: { draft: QuoteDraft; area: number; update: <K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) => void }) {
  return <div className="dimension-block"><div className="dimension-grid"><NumberField label="Length" value={draft.length} suffix="ft" update={(value) => update("length", value)} /><span className="dimension-times">×</span><NumberField label="Width" value={draft.width} suffix="ft" update={(value) => update("width", value)} /></div><div className="dimension-result" aria-live="polite"><span>Total turf area</span><strong>{formatNumber(area)} sq ft</strong></div></div>;
}

function NumberField({ label, value, update, prefix, suffix, step = 1 }: { label: string; value: number; update: (value: number) => void; prefix?: string; suffix?: string; step?: number }) {
  return <label className="number-field"><span>{label}</span><div>{prefix && <i>{prefix}</i>}<input type="number" min="0" step={step} value={value} onChange={(event) => update(numberValue(event.target.value))} />{suffix && <small>{suffix}</small>}</div></label>;
}

function ModeButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button type="button" className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>; }
function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) { return <button className="action-button" onClick={onClick}>{icon}<span>{label}</span></button>; }
function Metric({ label, value, suffix }: { label: string; value: string; suffix: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{suffix}</small></div>; }
function ToolRow({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) { return <button className="tool-row" onClick={onClick}><span>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={18} /></button>; }

function JobRow({ job }: { job: Job }) {
  return <article className="job-row"><div className="job-method">{job.method === "map" ? <Map size={17} /> : job.method === "camera" ? <Camera size={17} /> : <Ruler size={17} />}</div><div><h4>{job.address}</h4><p>{formatNumber(job.area)} sq ft · {job.infill} 40-lb bags · {formatCurrency(job.quote)}</p></div><span>{job.status}</span></article>;
}

function LoopStep({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="loop-step"><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><ChevronRight size={16} /></div>; }
function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}>{icon}<span>{label}</span></button>; }

function numberValue(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US").format(value); }
function formatCurrency(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function measurementLabel(method: MeasurementMode) { return method === "camera" ? "Camera measurement" : method === "map" ? "Map trace" : "Manual measurement"; }

const rootElement = document.getElementById("root")!;
const appWindow = window as Window & { __dirtyTurfRoot?: ReturnType<typeof createRoot> };
appWindow.__dirtyTurfRoot ??= createRoot(rootElement);
appWindow.__dirtyTurfRoot.render(<App />);
