import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-700.css";
import "@fontsource/outfit/latin-800.css";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/poppins/latin-800.css";
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
  CreditCard,
  Crosshair,
  Home,
  ImagePlus,
  LockKeyhole,
  Map,
  MapPin,
  Package,
  Plus,
  Ruler,
  Search,
  Send,
  Settings2,
  Smartphone,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { AcademyEvent, AppNotification, CommunityComment, CommunityPost, Course, Job, MeasurementMode, QuoteDraft, QuoteTotals, Member } from "./domain";
import {
  claimAcademyMemberships,
  getDataMode,
  getWorkspaceAccessState,
  initializeNativeAuth,
  loadComments,
  loadCourses,
  loadEvents,
  loadJobs,
  loadMembers,
  loadNotifications,
  loadPosts,
  markAllNotificationsRead,
  markNotificationRead,
  requestMagicLink,
  openAcademyBillingPortal,
  saveComment,
  saveJob,
  saveLessonCompletion,
  savePost,
  signOut,
  subscribeToNotifications,
  supabase,
  toggleAcademyEventRsvp,
  toggleCommentReaction,
  togglePostBookmark,
  togglePostReaction,
  type DataMode,
  type WorkspaceAccessState,
  webBillingAvailable,
} from "./lib/backend";
import { hasNativeLiveMeasurement, startNativeLiveMeasurement } from "./lib/liveMeasurement";
import { academyPaymentLink, checkoutReturnNotice } from "./lib/academyPaymentLink";
import { calculateQuote, INFILL_RATES } from "./lib/quote";
import { useModalDialog } from "./lib/useModalDialog";
import { AcademyView } from "./components/Academy";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { CommunityView } from "./components/Community";
import { EventsView } from "./components/Events";
import type { HubSection } from "./components/Network";
import { courses as seedCourses, initialComments, initialEvents, initialMembers, initialNotifications, initialPosts } from "./appData";
import "./styles.css";

const MapMeasurement = lazy(() =>
  import("./components/MapMeasurement").then((module) => ({ default: module.MapMeasurement })),
);
const HubSheet = lazy(() =>
  import("./components/Network").then((module) => ({ default: module.HubSheet })),
);

type View = "home" | "learn" | "community" | "events" | "tools";

const initialJobs: Job[] = [
  { id: 1, address: "Mesa backyard", area: 684, infill: 5, infillPounds: 171, bags50: 4, infillRate: 0.25, serviceRate: 0.72, quote: 492.48, status: "Calculated", method: "camera", createdAt: "Today", photos: 4 },
  { id: 2, address: "Scottsdale side yard", area: 312, infill: 2, infillPounds: 78, bags50: 2, infillRate: 0.25, serviceRate: 0.72, quote: 224.64, status: "Calculated", method: "map", createdAt: "Yesterday", photos: 0 },
  { id: 3, address: "Chandler dog run", area: 148, infill: 1, infillPounds: 37, bags50: 1, infillRate: 0.25, serviceRate: 0.72, quote: 106.56, status: "Calculated", method: "manual", createdAt: "Sep 12", photos: 6 },
];

const defaultDraft: QuoteDraft = {
  address: "",
  mode: "camera",
  length: 38,
  width: 18,
  cameraArea: 684,
  mapArea: 684,
  infillRate: 0.25,
  serviceRate: 0.72,
};

const navTitles: Record<View, string> = {
  home: "Dashboard",
  learn: "Academy",
  community: "Community",
  events: "Live calendar",
  tools: "Operator tools",
};

function initialViewFromUrl(): View {
  const requested = new URLSearchParams(window.location.search).get("view");
  return requested && requested in navTitles ? requested as View : "home";
}

function initialHubSectionFromUrl(): HubSection | null {
  const requested = new URLSearchParams(window.location.search).get("panel");
  return requested === "settings" || requested === "access" || requested === "notifications" ? requested : null;
}

function App() {
  const [activeView, setActiveView] = useState<View>(initialViewFromUrl);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hubSection, setHubSection] = useState<HubSection | null>(initialHubSectionFromUrl);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState<QuoteDraft>(defaultDraft);
  const [photoUrl, setPhotoUrl] = useState("");
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [courses, setCourses] = useState<Course[]>(seedCourses);
  const [posts, setPosts] = useState<CommunityPost[]>(initialPosts);
  const [comments, setComments] = useState<CommunityComment[]>(initialComments);
  const [events, setEvents] = useState<AcademyEvent[]>(initialEvents);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [notifications, setNotifications] = useState<AppNotification[]>(initialNotifications);
  const [requestedPostCloudId, setRequestedPostCloudId] = useState(() => new URLSearchParams(window.location.search).get("post") ?? undefined);
  const [dataMode, setDataMode] = useState<DataMode>("device");
  const [workspaceAccess, setWorkspaceAccess] = useState<
    WorkspaceAccessState | { status: "loading" }
  >({ status: "loading" });

  useEffect(() => {
    let mounted = true;
    let refreshId = 0;
    let disposeNativeAuth: () => void = () => undefined;

    const refreshWorkspace = async () => {
      const activeRefresh = ++refreshId;
      try {
        const mode = await getDataMode();
        if (mode === "cloud") await claimAcademyMemberships();
        const access = await getWorkspaceAccessState();
        if (!mounted || activeRefresh !== refreshId) return;
        setDataMode(mode);
        setWorkspaceAccess(access);
        if (access.status === "signed_out" || access.status === "no_access") {
          setJobs([]);
          setCourses([]);
          setPosts([]);
          setComments([]);
          setEvents([]);
          setMembers([]);
          setNotifications([]);
          return;
        }
        const [loadedJobs, loadedCourses, loadedPosts, loadedComments, loadedEvents, loadedMembers, loadedNotifications] = await Promise.all([
          loadJobs(initialJobs),
          loadCourses(seedCourses),
          loadPosts(initialPosts),
          loadComments(initialComments),
          loadEvents(initialEvents),
          loadMembers(initialMembers),
          loadNotifications(initialNotifications),
        ]);
        if (!mounted || activeRefresh !== refreshId) return;
        setJobs(loadedJobs);
        setCourses(loadedCourses);
        setPosts(loadedPosts);
        setComments(loadedComments);
        setEvents(loadedEvents);
        setMembers(loadedMembers);
        setNotifications(loadedNotifications);
      } catch {
        if (mounted && activeRefresh === refreshId) {
          setWorkspaceAccess(supabase ? { status: "no_access" } : { status: "preview" });
          setToast(supabase ? "Academy access could not be verified." : "Cloud data is unavailable. Working on this device.");
        }
      }
    };

    void refreshWorkspace();
    const authSubscription = supabase?.auth.onAuthStateChange((event) => {
      if (["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) {
        window.setTimeout(() => { void refreshWorkspace(); });
      }
    }).data.subscription;
    void initializeNativeAuth((message) => mounted && setToast(message)).then((dispose) => {
      if (mounted) disposeNativeAuth = dispose;
      else dispose();
    });
    const disposeNotifications = subscribeToNotifications(() => {
      void loadNotifications(initialNotifications)
        .then((items) => { if (mounted) setNotifications(items); })
        .catch(() => undefined);
    });

    return () => {
      mounted = false;
      authSubscription?.unsubscribe();
      disposeNativeAuth();
      disposeNotifications();
    };
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
      setToast("Measure a turf area before saving.");
      return;
    }
    const calculationLabel = draft.address.trim() || `${measurementLabel(draft.mode)} · ${formatNumber(quote.area)} sq ft`;
    const job: Job = {
      id: Date.now(),
      address: calculationLabel,
      area: quote.area,
      preciseArea: quote.preciseArea,
      infill: quote.bags40,
      infillPounds: quote.infillPounds,
      bags50: quote.bags50,
      infillRate: draft.infillRate,
      serviceRate: draft.serviceRate,
      quote: quote.total,
      status: "Calculated",
      method: draft.mode,
      createdAt: "Just now",
      photos: photoUrl ? 1 : 0,
    };
    try {
      const savedJob = await saveJob(job);
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
    if (view !== "community") setRequestedPostCloudId(undefined);
    setSearchOpen(false);
    setQuery("");
    document.querySelector(".phone-frame")?.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const sendMagicLink = async (email: string) => {
    try {
      const { error } = await requestMagicLink(email);
      if (error) throw error;
      setToast("If this email has Academy access, a secure sign-in link is on the way.");
    } catch {
      setToast("The sign-in link could not be requested. Check the connection and try again.");
    }
  };
  const handleSignOut = async () => {
    await signOut();
    setJobs(initialJobs);
    setCourses(seedCourses);
    setPosts(initialPosts);
    setComments(initialComments);
    setEvents(initialEvents);
    setMembers(initialMembers);
    setNotifications(initialNotifications);
    setDataMode("device");
    setWorkspaceAccess(supabase ? { status: "signed_out" } : { status: "preview" });
    setHubSection(null);
    setSearchOpen(false);
    setQuery("");
    setActiveView("home");
    setToast("Signed out of the workspace.");
  };

  const openNotification = (notification: AppNotification) => {
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    if (notification.cloudId) void markNotificationRead(notification.cloudId).catch(() => setToast("Notification could not be marked as read."));
    setHubSection(null);
    if (notification.targetType === "post") {
      setRequestedPostCloudId(notification.targetCloudId);
      changeView("community");
    } else if (notification.targetType === "event") {
      changeView("events");
    } else if (notification.targetType === "course") {
      changeView("learn");
    } else {
      changeView("community");
    }
  };

  const markEveryNotificationRead = async () => {
    const previous = notifications;
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    try {
      await markAllNotificationsRead();
    } catch {
      setNotifications(previous);
      setToast("Notifications could not be updated.");
    }
  };

  const unreadNotifications = notifications.filter((notification) => !notification.read).length;

  if (workspaceAccess.status === "loading" || workspaceAccess.status === "signed_out" || workspaceAccess.status === "no_access") {
    return <LaunchAccessGate
      status={workspaceAccess.status}
      onRequestMagicLink={sendMagicLink}
      onSignOut={handleSignOut}
    />;
  }

  return (
    <main className="app-shell">
      <aside className="desktop-sidebar" aria-label="Workspace navigation">
        <div className="desktop-brand">
          <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
          <div><strong>Dirty Turf</strong><span>Academy & field tools</span></div>
        </div>
        <button className="desktop-new-calculation" onClick={() => openQuote("manual")}><Plus size={18} /> New calculation</button>
        <nav className="desktop-nav" aria-label="App sections">
          <DesktopNavItem icon={<Home size={19} />} label="Dashboard" active={activeView === "home"} onClick={() => changeView("home")} />
          <DesktopNavItem icon={<BookOpen size={19} />} label="Academy" active={activeView === "learn"} onClick={() => changeView("learn")} />
          <DesktopNavItem icon={<Users size={19} />} label="Community" active={activeView === "community"} onClick={() => changeView("community")} />
          <DesktopNavItem icon={<CalendarDays size={19} />} label="Events" active={activeView === "events"} onClick={() => changeView("events")} />
          <DesktopNavItem icon={<Wrench size={19} />} label="Field tools" active={activeView === "tools"} onClick={() => changeView("tools")} />
        </nav>
        <div className="desktop-sidebar-footer">
          <button className={`desktop-workspace-status ${dataMode}`} onClick={() => setHubSection(dataMode === "cloud" ? "settings" : "access")}>
            <span />
            <div><strong>{dataMode === "cloud" ? "Workspace synced" : "Device preview"}</strong><small>{dataMode === "cloud" ? "Cloud data is current" : "Review without an account"}</small></div>
          </button>
          <button className="desktop-settings" onClick={() => setHubSection("settings")}><Settings2 size={18} /> Workspace settings</button>
        </div>
      </aside>

      <section className="phone-frame workspace-frame" aria-label="Dirty Turf Academy workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
            <div><h1>{navTitles[activeView]}</h1><button className={`data-mode ${dataMode}`} onClick={() => setHubSection(dataMode === "cloud" ? "settings" : "access")}>{dataMode === "cloud" ? "Workspace synced" : "Device preview"}</button></div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" aria-label={`Open notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`} onClick={() => setHubSection("notifications")}><Bell size={18} />{unreadNotifications > 0 && <span>{Math.min(unreadNotifications, 99)}</span>}</button>
            <button className={searchOpen ? "icon-button active" : "icon-button"} aria-label={searchOpen ? "Close search" : "Search"} onClick={() => setSearchOpen((open) => !open)}>{searchOpen ? <X size={19} /> : <Search size={19} />}</button>
            <button className="profile-button" aria-label="Open workspace menu" onClick={() => setHubSection("settings")}>DT</button>
          </div>
        </header>

        {searchOpen && <SearchPanel query={query} setQuery={setQuery} jobs={jobs} onOpenJob={() => openQuote("manual")} onNavigate={changeView} />}
        {!searchOpen && activeView === "home" && <HomeView jobs={jobs} openQuote={openQuote} changeView={changeView} />}
        {!searchOpen && activeView === "tools" && <ToolsView draft={draft} quote={quote} openQuote={openQuote} setToast={setToast} />}
        {!searchOpen && activeView === "learn" && <AcademyView courses={courses} dataMode={dataMode} onCoursesChange={setCourses} onLessonCompletion={saveLessonCompletion} onToast={setToast} onDiscuss={() => changeView("community")} />}
        {!searchOpen && activeView === "community" && <CommunityView posts={posts} comments={comments} members={members} events={events} requestedPostCloudId={requestedPostCloudId} onRequestedPostOpened={() => setRequestedPostCloudId(undefined)} onPostsChange={setPosts} onCommentsChange={setComments} onCreatePost={savePost} onCreateComment={saveComment} onToggleLike={(post) => post.cloudId ? togglePostReaction(post.cloudId) : Promise.resolve(null)} onToggleCommentLike={(comment) => comment.cloudId ? toggleCommentReaction(comment.cloudId) : Promise.resolve(null)} onToggleBookmark={(post) => post.cloudId ? togglePostBookmark(post.cloudId) : Promise.resolve(null)} onNavigate={changeView} onToast={setToast} />}
        {!searchOpen && activeView === "events" && <EventsView events={events} onEventsChange={setEvents} onToggleRsvp={(event) => event.cloudId ? toggleAcademyEventRsvp(event.cloudId) : Promise.resolve(null)} onToast={setToast} />}

        <footer className="bottom-nav" aria-label="App sections">
          <NavItem icon={<Home size={20} />} label="Home" active={activeView === "home"} onClick={() => changeView("home")} />
          <NavItem icon={<BookOpen size={20} />} label="Learn" active={activeView === "learn"} onClick={() => changeView("learn")} />
          <NavItem icon={<Users size={20} />} label="Community" active={activeView === "community"} onClick={() => changeView("community")} />
          <NavItem icon={<CalendarDays size={20} />} label="Events" active={activeView === "events"} onClick={() => changeView("events")} />
          <NavItem icon={<Wrench size={20} />} label="Tools" active={activeView === "tools"} onClick={() => changeView("tools")} />
        </footer>

        {quoteOpen && <QuoteSheet draft={draft} setDraft={setDraft} quote={quote} photoUrl={photoUrl} setPhotoUrl={setPhotoUrl} onClose={() => setQuoteOpen(false)} onSave={saveQuote} />}
        {hubSection && <Suspense fallback={<div className="sheet-loading" role="status">Loading workspace...</div>}><HubSheet section={hubSection} onClose={() => setHubSection(null)} onToast={setToast} onRequestMagicLink={sendMagicLink} onSignOut={handleSignOut} dataMode={dataMode} notifications={notifications} onOpenNotification={openNotification} onMarkAllNotificationsRead={markEveryNotificationRead} /></Suspense>}
        {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
      </section>
    </main>
  );
}

function LaunchAccessGate({
  status,
  onRequestMagicLink,
  onSignOut,
}: {
  status: "loading" | "signed_out" | "no_access";
  onRequestMagicLink: (email: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const paymentLink = academyPaymentLink();
  const checkoutNotice = checkoutReturnNotice(window.location.search);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await onRequestMagicLink(email.trim());
      setMessage("If this email has Academy access, a secure sign-in link is on the way.");
    } catch {
      setMessage("The sign-in link could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const manageBilling = async () => {
    setBusy(true);
    setMessage("");
    try {
      await openAcademyBillingPortal();
    } catch {
      setMessage("No web billing account is connected to this login yet.");
      setBusy(false);
    }
  };

  if (status === "loading") {
    return <main className="launch-gate"><section className="launch-card loading" role="status"><img src="/dirty-turf-logo.png" alt="Dirty Turf" /><span className="launch-spinner" /><p>Checking Academy access...</p></section></main>;
  }

  return <main className="launch-gate">
    <section className="launch-card">
      <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
      <span className="launch-lock"><LockKeyhole size={25} /></span>
      {checkoutNotice && <p className="launch-notice" role="status"><CheckCircle2 size={17} />{checkoutNotice}</p>}
      {status === "signed_out" ? <>
        <p className="kicker">Dirty Turf Academy</p>
        <h1>Welcome back.</h1>
        <p className="launch-copy">Enter the email connected to your Academy membership. No password is needed.</p>
        <form className="access-form" onSubmit={submit}>
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@company.com" autoComplete="email" inputMode="email" required /></label>
          <button className="primary-button wide" disabled={busy || !email.trim()}>{busy ? "Sending..." : "Email me a sign-in link"}</button>
        </form>
        {paymentLink && <div className="launch-purchase"><span>Not a member yet?</span><a className="secondary-button wide" href={paymentLink}><CreditCard size={17} /> Join Academy on the web</a></div>}
      </> : <>
        <p className="kicker">Account found</p>
        <h1>Access is not active.</h1>
        <p className="launch-copy">This login is valid, but it does not currently have an active Academy or course entitlement.</p>
        {paymentLink && <a className="primary-button wide" href={paymentLink}><CreditCard size={17} /> Get Academy access</a>}
        {webBillingAvailable() && <button className="secondary-button wide" disabled={busy} onClick={() => void manageBilling()}>{busy ? "Opening..." : "Manage web billing"}</button>}
        <button className="secondary-button wide" disabled={busy} onClick={() => void onSignOut()}>Use a different email</button>
      </>}
      {message && <p className="launch-message" role="status">{message}</p>}
      <p className="launch-support">Need help? <a href="mailto:hello@dirtyturf.com">hello@dirtyturf.com</a></p>
      <nav className="launch-legal" aria-label="Privacy and support"><a href="/privacy.html">Privacy</a><a href="/support.html">Support</a><a href="/delete-account.html">Delete account</a></nav>
    </section>
  </main>;
}

function HomeView({ jobs, openQuote, changeView }: { jobs: Job[]; openQuote: (mode: MeasurementMode) => void; changeView: (view: View) => void }) {
  const latest = jobs[0];
  return (
    <div className="view-content home-view">
      <section className="field-hero">
        <div className="field-text"><p>Dirty Turf operator</p><h2>Measure it right. Quote the clean it actually needs.</h2><button className="hero-action" onClick={() => openQuote("camera")}><Camera size={17} /> Start measurement</button></div>
        <div className="field-scanner" aria-hidden="true"><div className="scanner-grid" /><div className="scanner-chip">{latest ? `${formatNumber(latest.area)} sq ft` : "Ready to measure"}</div><div className="scanner-pin one" /><div className="scanner-pin two" /><div className="scanner-pin three" /></div>
      </section>

      <nav className="quick-actions" aria-label="Primary tools">
        <Action icon={<Camera size={20} />} label="Camera measure" onClick={() => openQuote("camera")} />
        <Action icon={<Map size={20} />} label="Map trace" onClick={() => openQuote("map")} />
        <Action icon={<Package size={20} />} label="Infill calculator" onClick={() => changeView("tools")} />
        <Action icon={<BookOpen size={20} />} label="Academy" onClick={() => changeView("learn")} />
      </nav>

      <section className="tool-panel">
        {latest ? <>
          <div className="section-heading"><div><p>Latest estimate</p><h3>{latest.address}</h3></div><button className="ghost-button" onClick={() => openQuote("manual")}>New <Plus size={16} /></button></div>
          <div className="quote-grid"><Metric label="Area" value={formatNumber(latest.area)} suffix="sq ft" /><Metric label="Infill" value={String(latest.infill)} suffix="40-lb bags" /><Metric label="Price" value={formatCurrency(latest.quote)} suffix="customer" /></div>
          <div className="quote-line"><Ruler size={18} /><span>{measurementLabel(latest.method)} saved to property history.</span><Check size={18} /></div>
        </> : <div className="dashboard-empty"><Ruler size={24} /><div><p>First calculation</p><h3>No saved measurements yet</h3><span>Measure a yard to calculate infill bags and customer price.</span></div><button className="ghost-button" onClick={() => openQuote("manual")}>Start <Plus size={16} /></button></div>}
      </section>

      {latest && <section className="history-strip">
        <div className="section-heading compact"><div><p>Site history</p><h3>Photos by visit</h3></div><button className="bare-icon" aria-label="View all site photos"><ChevronRight size={18} /></button></div>
        <div className="photo-row" aria-label="Past turf photos"><div className="photo-tile spring"><span>Today</span><small>After service</small></div><div className="photo-tile summer"><span>2025</span><small>Infill refresh</small></div><div className="photo-tile winter"><span>2024</span><small>First visit</small></div></div>
      </section>}

      <section className="academy-preview">
        <div className="section-heading"><div><p>Academy</p><h3>Continue your operator training</h3></div><button className="text-button" onClick={() => changeView("learn")}>Open</button></div>
        <button className="academy-live-link" onClick={() => changeView("learn")}><span><BookOpen size={18} /></span><span><strong>Dirty Turf Academy</strong><small>Your courses and progress live inside the app.</small></span><ChevronRight size={17} /></button>
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
      <section className="tool-lead"><div><p className="kicker">Field kit</p><h2>Measure turf. Calculate infill.</h2></div><button className="primary-button" onClick={() => openQuote("camera")}><Plus size={18} /> New calculation</button></section>
      <section className="live-estimate"><div className="estimate-total"><span>Current calculation</span><strong>{quote.bags40} bags</strong><small>{formatNumber(quote.area)} sq ft · {formatNumber(quote.infillPounds)} lb total · 40-lb bags</small></div><button className="edit-estimate" onClick={() => openQuote(draft.mode)} aria-label="Edit current calculation"><Settings2 size={19} /></button></section>
      <section className="tool-list" aria-label="Measurement tools">
        <ToolRow icon={<Camera size={20} />} title="Live camera measure" detail="Place AR points around the turf boundary" onClick={() => openQuote("camera")} />
        <ToolRow icon={<Map size={20} />} title="Map trace" detail="Outline a remote property before the visit" onClick={() => openQuote("map")} />
        <ToolRow icon={<Calculator size={20} />} title="Manual calculation" detail="Use known length and width" onClick={() => openQuote("manual")} />
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
    { type: "Academy", title: "Course library", detail: "Courses, lessons, resources, and progress", icon: <BookOpen size={18} />, action: () => onNavigate("learn") },
    { type: "Community", title: "7 Figure Turf Cleaning", detail: "Discussions, members, and operator answers", icon: <Users size={18} />, action: () => onNavigate("community") },
    { type: "Events", title: "Academy event calendar", detail: "Sessions, workshops, and RSVPs", icon: <CalendarDays size={18} />, action: () => onNavigate("events") },
  ].filter((item) => !normalized || `${item.type} ${item.title} ${item.detail}`.toLowerCase().includes(normalized));
  return (
    <section className="search-view"><label className="search-input"><Search size={19} /><span className="sr-only">Search properties and Academy destinations</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search properties and Academy" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button>}</label><p className="result-count">{results.length} {normalized ? "matches" : "destinations and recent properties"}</p><div className="search-results">{results.slice(0, 9).map((item) => <button className="result-row" key={`${item.type}-${item.title}`} onClick={item.action}><span className="result-icon">{item.icon}</span><span><small>{item.type}</small><strong>{item.title}</strong><em>{item.detail}</em></span><ChevronRight size={17} /></button>)}{results.length === 0 && <div className="empty-state"><Search size={24} /><h3>No matches yet</h3><p>Try a saved calculation, Academy, community, or events.</p></div>}</div></section>
  );
}

function QuoteSheet({ draft, setDraft, quote, photoUrl, setPhotoUrl, onClose, onSave }: { draft: QuoteDraft; setDraft: React.Dispatch<React.SetStateAction<QuoteDraft>>; quote: QuoteTotals; photoUrl: string; setPhotoUrl: (url: string) => void; onClose: () => void; onSave: () => void | Promise<void> }) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(dialogRef, onClose);
  const update = <K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const changePhoto = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) setPhotoUrl(URL.createObjectURL(file)); };
  return (
    <div className="sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="quote-sheet" role="dialog" aria-modal="true" aria-labelledby="quote-title">
        <header className="sheet-header"><button className="bare-icon" aria-label="Close infill calculator" onClick={onClose} data-dialog-autofocus><ArrowLeft size={20} /></button><div><p>Measurement</p><h2 id="quote-title">Infill calculator</h2></div><button className="save-link" onClick={onSave}>Save</button></header>
        <div className="sheet-body">
          <fieldset className="mode-fieldset"><legend>Measurement method</legend><div className="segmented-control"><ModeButton icon={<Camera size={17} />} label="Camera" active={draft.mode === "camera"} onClick={() => update("mode", "camera")} /><ModeButton icon={<Map size={17} />} label="Map" active={draft.mode === "map"} onClick={() => update("mode", "map")} /><ModeButton icon={<Ruler size={17} />} label="Manual" active={draft.mode === "manual"} onClick={() => update("mode", "manual")} /></div></fieldset>
          {draft.mode === "camera" && <LiveCameraMeasurement area={draft.cameraArea} onAreaChange={(value) => update("cameraArea", value)} photoUrl={photoUrl} changePhoto={changePhoto} />}
          {draft.mode === "manual" && <DimensionInputs draft={draft} update={update} />}
          {draft.mode === "map" && <Suspense fallback={<div className="map-loading" role="status">Loading property map...</div>}><MapMeasurement address={draft.address} area={draft.mapArea} onAddressChange={(value) => update("address", value)} onAreaChange={(value) => update("mapArea", value)} /></Suspense>}
          <section className="infill-controls"><label className="field-label">Infill rate<select value={draft.infillRate} onChange={(event) => update("infillRate", numberValue(event.target.value))}>{INFILL_RATES.map((rate) => <option key={rate} value={rate}>{rate.toFixed(2)} lb / sq ft</option>)}</select></label><NumberField label="What you charge" value={draft.serviceRate} prefix="$" suffix="/ sq ft" step={0.01} update={(value) => update("serviceRate", value)} /></section>
          <section className="infill-summary" aria-label="Infill calculation results"><div className="area-total"><span>Total turf area</span><strong>{formatNumber(quote.area)}</strong><small>square feet</small></div><div className="infill-result-grid"><div><span>Total infill</span><strong>{formatNumber(quote.infillPounds)} lb</strong></div><div><span>40-lb bags</span><strong>{quote.bags40}</strong></div><div><span>50-lb bags</span><strong>{quote.bags50}</strong></div></div><div className="customer-price"><span>Customer price</span><strong>{formatCurrency(quote.serviceTotal)}</strong></div></section>
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
      onAreaChange(result.areaSquareFeet);
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

function DimensionInputs({ draft, update }: { draft: QuoteDraft; update: <K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) => void }) {
  return <div className="dimension-grid"><NumberField label="Length" value={draft.length} suffix="ft" update={(value) => update("length", value)} /><span className="dimension-times">×</span><NumberField label="Width" value={draft.width} suffix="ft" update={(value) => update("width", value)} /></div>;
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

function DesktopNavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? "desktop-nav-item active" : "desktop-nav-item"} onClick={onClick}>{icon}<span>{label}</span></button>; }
function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}>{icon}<span>{label}</span></button>; }

function numberValue(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US").format(value); }
function formatCurrency(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function measurementLabel(method: MeasurementMode) { return method === "camera" ? "Camera measurement" : method === "map" ? "Map trace" : "Manual measurement"; }

const rootElement = document.getElementById("root")!;
const appWindow = window as Window & { __dirtyTurfRoot?: ReturnType<typeof createRoot> };
appWindow.__dirtyTurfRoot ??= createRoot(rootElement);
appWindow.__dirtyTurfRoot.render(<AppErrorBoundary><App /></AppErrorBoundary>);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    document.documentElement.dataset.offlineCache = "registering";
    navigator.serviceWorker.register("/sw.js")
      .then(async (registration) => {
        await navigator.serviceWorker.ready;
        registration.active?.postMessage({ type: "PRECACHE_APP" });
        document.documentElement.dataset.offlineCache = "ready";
      })
      .catch((error) => {
        document.documentElement.dataset.offlineCache = "unavailable";
        console.warn("Dirty Turf offline cache is unavailable", error);
      });
  });
}
