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
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import type { AcademyCertificate, AcademyEvent, AppNotification, CommunityComment, CommunityPost, Course, Job, MeasurementMode, QuoteDraft, QuoteTotals, Member } from "./domain";
import {
  claimAcademyMemberships,
  getDataMode,
  getWorkspaceAccessState,
  initializeNativeAuth,
  loadAcademyCertificates,
  loadBlockedAcademyMemberIds,
  loadComments,
  loadCourses,
  loadEvents,
  loadJobs,
  loadMembers,
  loadNotifications,
  loadPosts,
  setAcademyMemberFollow,
  markAllNotificationsRead,
  markNotificationRead,
  recordAcademyQuizAttempt,
  requestAcademyCertificate,
  requestMagicLink,
  reportAcademyContent,
  openAcademyBillingPortal,
  saveComment,
  saveJob,
  saveLessonCompletion,
  savePost,
  signInWithPassword,
  signOut,
  subscribeToNotifications,
  supabase,
  toggleAcademyEventRsvp,
  toggleCommentReaction,
  togglePostBookmark,
  togglePostReaction,
  toggleAcademyMemberBlock,
  verifyAcademyCertificate,
  type DataMode,
  type CommunityPostCursor,
  type WorkspaceAccessState,
  webBillingAvailable,
} from "./lib/backend";
import { hasNativeLiveMeasurement, startNativeLiveMeasurement } from "./lib/liveMeasurement";
import { academyPaymentLink, checkoutReturnNotice } from "./lib/academyPaymentLink";
import { cloudCollectionOrEmpty } from "./lib/cloudCollection";
import { createCommunityPostPageGate } from "./lib/communityPostPageGate";
import { calculateQuote, INFILL_RATES } from "./lib/quote";
import { useModalDialog } from "./lib/useModalDialog";
import { AcademyView } from "./components/Academy";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { CommunityView } from "./components/Community";
import { EventsView } from "./components/Events";
import { PrimaryNavigation, type PrimaryNavigationView } from "./components/PrimaryNavigation";
import type { HubSection } from "./components/Network";
import { courses as seedCourses, initialComments, initialEvents, initialMembers, initialNotifications, initialPosts } from "./appData";
import "./styles.css";

const MapMeasurement = lazy(() =>
  import("./components/MapMeasurement").then((module) => ({ default: module.MapMeasurement })),
);
const HubSheet = lazy(() =>
  import("./components/Network").then((module) => ({ default: module.HubSheet })),
);
const AdminStudio = lazy(() =>
  import("./components/AdminStudio").then((module) => ({ default: module.AdminStudio })),
);

type View = PrimaryNavigationView;

type PublicCertificateResult = Awaited<ReturnType<typeof verifyAcademyCertificate>>;

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
  community: "Academy",
  events: "Academy",
  admin: "Admin Studio",
};

function initialViewFromUrl(): View {
  const requested = new URLSearchParams(window.location.search).get("view");
  if (requested === "tools") return "home";
  return requested && requested in navTitles ? requested as View : "home";
}

function initialHubSectionFromUrl(): HubSection | null {
  const requested = new URLSearchParams(window.location.search).get("panel");
  return requested === "settings" || requested === "access" || requested === "notifications" ? requested : null;
}

function CertificateVerificationPage({ code }: { code: string }) {
  const [result, setResult] = useState<PublicCertificateResult | undefined>();
  useEffect(() => {
    let active = true;
    void verifyAcademyCertificate(code).then((value) => { if (active) setResult(value); }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
  }, [code]);
  return <main className="certificate-verification-page"><section>
    <img src="/dirty-turf-logo.png" alt="Dirty Turf Academy" />
    {result === undefined ? <><ShieldCheck size={34} /><h1>Verifying certificate…</h1><p>Checking the Academy’s secure certificate record.</p></> : result ? <><CheckCircle2 size={38} className={result.valid ? "valid" : "invalid"} /><h1>{result.valid ? "Certificate verified" : "Certificate is not active"}</h1><p><strong>{result.recipientName}</strong> completed <strong>{result.courseTitle}</strong>.</p><span>Issued {result.issuedAt ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(result.issuedAt)) : "date unavailable"} · Status: {result.status}</span></> : <><LockKeyhole size={38} className="invalid" /><h1>Certificate not found</h1><p>This verification code does not match a Dirty Turf Academy certificate.</p></>}
    <a href="/">Open Dirty Turf Academy</a>
  </section></main>;
}

function App() {
  const [activeView, setActiveView] = useState<View>(initialViewFromUrl);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hubSection, setHubSection] = useState<HubSection | null>(initialHubSectionFromUrl);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [cloudLoadError, setCloudLoadError] = useState("");
  const [draft, setDraft] = useState<QuoteDraft>(defaultDraft);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<Job[]>(supabase ? [] : initialJobs);
  const [courses, setCourses] = useState<Course[]>(supabase ? [] : seedCourses);
  const [posts, setPosts] = useState<CommunityPost[]>(supabase ? [] : initialPosts);
  const [postCursor, setPostCursor] = useState<CommunityPostCursor | undefined>();
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const postPageGate = useRef(createCommunityPostPageGate());
  const [comments, setComments] = useState<CommunityComment[]>(supabase ? [] : initialComments);
  const [events, setEvents] = useState<AcademyEvent[]>(supabase ? [] : initialEvents);
  const [members, setMembers] = useState<Member[]>(supabase ? [] : initialMembers);
  const [notifications, setNotifications] = useState<AppNotification[]>(supabase ? [] : initialNotifications);
  const [arrivalChecks, setArrivalChecks] = useState<boolean[]>([false, false, false, false]);
  const [certificates, setCertificates] = useState<AcademyCertificate[]>([]);
  const [requestedPostCloudId, setRequestedPostCloudId] = useState(() => new URLSearchParams(window.location.search).get("post") ?? undefined);
  const [dataMode, setDataMode] = useState<DataMode>("device");
  const [workspaceAccess, setWorkspaceAccess] = useState<
    WorkspaceAccessState | { status: "loading" }
  >({ status: "loading" });
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const canManage = workspaceAccess.status === "member" && workspaceAccess.canManage;

  const clearWorkspaceContent = () => {
    setJobs([]);
    setCourses([]);
    setPosts([]);
    setComments([]);
    setEvents([]);
    setMembers([]);
    setNotifications([]);
    setCertificates([]);
  };

  useEffect(() => {
    let mounted = true;
    let refreshId = 0;
    let disposeNativeAuth: () => void = () => undefined;

    const refreshWorkspace = async () => {
      const activeRefresh = ++refreshId;
      postPageGate.current.refresh();
      setLoadingMorePosts(false);
      setHasMorePosts(false);
      setPostCursor(undefined);
      if (supabase) {
        setWorkspaceAccess({ status: "loading" });
        setCloudLoadError("");
        clearWorkspaceContent();
      }
      try {
        const mode = await getDataMode();
        if (mode === "cloud") await claimAcademyMemberships();
        const access = await getWorkspaceAccessState();
        if (!mounted || activeRefresh !== refreshId) return;
        if (access.status === "signed_out" || access.status === "no_access") {
          clearWorkspaceContent();
          setDataMode(mode);
          setWorkspaceAccess(access);
          return;
        }
        const results = await Promise.allSettled([
          loadJobs(initialJobs),
          loadCourses(seedCourses),
          loadPosts(initialPosts),
          loadComments(initialComments),
          loadEvents(initialEvents),
          loadMembers(initialMembers),
          loadNotifications(initialNotifications),
          loadAcademyCertificates(),
        ] as const);
        if (!mounted || activeRefresh !== refreshId) return;
        const [jobsResult, coursesResult, postsResult, commentsResult, eventsResult, membersResult, notificationsResult, certificatesResult] = results;
        setJobs(cloudCollectionOrEmpty(jobsResult));
        setCourses(cloudCollectionOrEmpty(coursesResult));
        if (postsResult.status === "fulfilled") {
          postPageGate.current.activate();
          setPosts(postsResult.value.posts);
          setPostCursor(postsResult.value.nextCursor);
          setHasMorePosts(postsResult.value.hasMore);
        } else setPosts([]);
        setComments(cloudCollectionOrEmpty(commentsResult));
        setEvents(cloudCollectionOrEmpty(eventsResult));
        setMembers(cloudCollectionOrEmpty(membersResult));
        setNotifications(cloudCollectionOrEmpty(notificationsResult));
        setCertificates(cloudCollectionOrEmpty(certificatesResult));
        setDataMode(mode);
        setWorkspaceAccess(access);
        const names = ["jobs", "courses", "posts", "comments", "events", "members", "notifications", "certificates"];
        const failed = results.flatMap((result, index) => result.status === "rejected" ? [names[index]] : []);
        setCloudLoadError(failed.length ? `Could not load ${failed.join(", ")}. This content is unavailable until you retry.` : "");
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
      postPageGate.current.refresh();
      authSubscription?.unsubscribe();
      disposeNativeAuth();
      disposeNotifications();
    };
  }, [workspaceRefreshToken]);

  const loadMoreCommunityPosts = async () => {
    if (!hasMorePosts) return;
    const requestGeneration = postPageGate.current.begin();
    if (requestGeneration === null) return;
    setLoadingMorePosts(true);
    try {
      const page = await loadPosts(initialPosts, postCursor);
      if (!postPageGate.current.isCurrent(requestGeneration)) return;
      setPosts((current) => {
        const existing = new Set(current.map((post) => post.cloudId ?? String(post.id)));
        return [...current, ...page.posts.filter((post) => !existing.has(post.cloudId ?? String(post.id)))];
      });
      setPostCursor(page.nextCursor);
      setHasMorePosts(page.hasMore);
    } catch {
      if (postPageGate.current.isCurrent(requestGeneration)) setToast("More posts could not load. Try again.");
    } finally {
      if (postPageGate.current.finish(requestGeneration)) setLoadingMorePosts(false);
    }
  };

  useEffect(() => {
    if (!toast || ["loading", "signed_out", "no_access"].includes(workspaceAccess.status)) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast, workspaceAccess.status]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", activeView);
    if (activeView !== "community") url.searchParams.delete("post");
    window.history.replaceState(window.history.state, "", url);
  }, [activeView]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  useEffect(() => {
    if (activeView === "admin" && workspaceAccess.status !== "loading" && !canManage) setActiveView("learn");
  }, [activeView, canManage, workspaceAccess.status]);

  const quote = calculateQuote(draft);

  const openQuote = (mode: MeasurementMode = "camera") => {
    setDraft((current) => ({ ...current, mode }));
    setHubSection(null);
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
      const savedJob = await saveJob(job, photoFile ?? undefined);
      setJobs((current) => [savedJob, ...current.filter((item) => item.id !== savedJob.id)]);
      setPhotoFile(null);
      setPhotoUrl("");
      setQuoteOpen(false);
      setActiveView("home");
      setToast(dataMode === "cloud" ? "Calculation synced to the company workspace." : "Calculation saved on this device.");
    } catch {
      setToast("Calculation could not be saved. Check the connection and try again.");
    }
  };

  const changeView = (view: View) => {
    setActiveView(view);
    setHubSection(null);
    setQuoteOpen(false);
    if (view !== "community") setRequestedPostCloudId(undefined);
    setSearchOpen(false);
    setQuery("");
    document.querySelector(".phone-frame")?.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const openSettings = () => {
    setQuoteOpen(false);
    setHubSection("settings");
  };

  const sendMagicLink = async (email: string) => {
    try {
      const { error } = await requestMagicLink(email);
      if (error) throw error;
      setToast("If this email has Academy access, a secure sign-in link is on the way.");
    } catch (error) {
      setToast("The sign-in link could not be requested. Check the connection and try again.");
      throw error;
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
    setArrivalChecks([false, false, false, false]);
    setDataMode("device");
    setWorkspaceAccess(supabase ? { status: "signed_out" } : { status: "preview" });
    setHubSection(null);
    setSearchOpen(false);
    setQuery("");
    setActiveView("home");
    setToast("Signed out of the workspace.");
  };
  const handlePasswordSignIn = async (email: string, password: string) => {
    const { error } = await signInWithPassword(email, password);
    if (error) throw error;
    setToast("Signed in to the Academy workspace.");
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
      authMessage={toast}
      onRequestMagicLink={sendMagicLink}
      onPasswordSignIn={handlePasswordSignIn}
      onSignOut={handleSignOut}
    />;
  }

  return (
    <main className="app-shell">
      <aside className="desktop-sidebar" aria-label="Workspace navigation">
        <div className="desktop-brand">
          <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
        </div>
        <button className="desktop-new-calculation" onClick={() => openQuote("manual")} aria-label="New calculation" title="New calculation"><Plus size={18} /><span>New calculation</span></button>
        <nav className="desktop-nav" aria-label="App sections">
          <DesktopNavItem icon={<Home size={19} />} label="Dashboard" active={activeView === "home"} onClick={() => changeView("home")} />
          <DesktopNavItem icon={<BookOpen size={19} />} label="Academy" active={["learn", "community", "events"].includes(activeView)} onClick={() => changeView("learn")} />
          {canManage && <DesktopNavItem icon={<ShieldCheck size={19} />} label="Admin Studio" active={activeView === "admin"} onClick={() => changeView("admin")} />}
        </nav>
        <div className="desktop-sidebar-footer">
          <button className={`desktop-workspace-status ${dataMode}`} onClick={() => setHubSection(dataMode === "cloud" ? "settings" : "access")} aria-label={dataMode === "cloud" ? "Workspace synced" : "Device preview"} title={dataMode === "cloud" ? "Workspace synced" : "Device preview"}>
            <span />
          </button>
          <button className="desktop-settings" onClick={() => setHubSection("settings")} aria-label="Workspace settings" title="Workspace settings"><Settings2 size={18} /><span>Workspace settings</span></button>
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
          </div>
        </header>

        {cloudLoadError && <div className="cloud-load-alert" role="alert"><span>{cloudLoadError}</span><button type="button" onClick={() => setWorkspaceRefreshToken((token) => token + 1)}>Try again</button></div>}

        {searchOpen && <SearchPanel query={query} setQuery={setQuery} jobs={jobs} onOpenJob={() => openQuote("manual")} onNavigate={changeView} />}
        {!searchOpen && activeView !== "home" && <AcademyTabs activeView={activeView} canManage={canManage} onNavigate={changeView} />}
        {!searchOpen && activeView === "home" && <HomeView jobs={jobs} openQuote={openQuote} checks={arrivalChecks} setChecks={setArrivalChecks} setToast={setToast} />}
        {!searchOpen && activeView === "learn" && <AcademyView courses={courses} certificates={certificates} dataMode={dataMode} onCoursesChange={setCourses} onLessonCompletion={saveLessonCompletion} onQuizAttempt={recordAcademyQuizAttempt} onRequestCertificate={async (courseId) => { await requestAcademyCertificate(courseId); setCertificates(await loadAcademyCertificates()); }} onToast={setToast} onDiscuss={() => changeView("community")} />}
        {!searchOpen && activeView === "community" && <CommunityView posts={posts} comments={comments} members={members} events={events} requestedPostCloudId={requestedPostCloudId} onRequestedPostOpened={() => setRequestedPostCloudId(undefined)} onPostsChange={setPosts} onCommentsChange={setComments} onMembersChange={setMembers} onToggleFollow={(member, following) => member.cloudId ? setAcademyMemberFollow(member.cloudId, following) : Promise.resolve(following)} onLoadMorePosts={loadMoreCommunityPosts} hasMorePosts={hasMorePosts} loadingMorePosts={loadingMorePosts} onCreatePost={savePost} onCreateComment={saveComment} onToggleLike={(post) => post.cloudId ? togglePostReaction(post.cloudId) : Promise.resolve(null)} onToggleCommentLike={(comment) => comment.cloudId ? toggleCommentReaction(comment.cloudId) : Promise.resolve(null)} onToggleBookmark={(post) => post.cloudId ? togglePostBookmark(post.cloudId) : Promise.resolve(null)} onReport={(contentType, contentId, reason) => reportAcademyContent(contentType, contentId, reason).then(() => undefined)} onBlockMember={toggleAcademyMemberBlock} onLoadBlockedMembers={loadBlockedAcademyMemberIds} onRefreshCommunity={() => setWorkspaceRefreshToken((current) => current + 1)} onNavigate={changeView} onToast={setToast} />}
        {!searchOpen && activeView === "events" && <EventsView events={events} onEventsChange={setEvents} onToggleRsvp={(event) => event.cloudId ? toggleAcademyEventRsvp(event.cloudId) : Promise.resolve(null)} onToast={setToast} />}
        {!searchOpen && activeView === "admin" && canManage && <Suspense fallback={<div className="admin-loading" role="status">Loading Admin Studio...</div>}><AdminStudio onToast={setToast} onContentChange={() => setWorkspaceRefreshToken((token) => token + 1)} /></Suspense>}

        {!quoteOpen && !hubSection && <PrimaryNavigation activeView={activeView} settingsOpen={false} onNavigate={changeView} onOpenSettings={openSettings} />}

        {quoteOpen && <QuoteSheet draft={draft} setDraft={setDraft} quote={quote} photoUrl={photoUrl} setPhotoUrl={setPhotoUrl} setPhotoFile={setPhotoFile} onClose={() => setQuoteOpen(false)} onSave={saveQuote} onError={setToast} primaryNavigation={<PrimaryNavigation activeView={activeView} settingsOpen={false} onNavigate={changeView} onOpenSettings={openSettings} />} />}
        {hubSection && <Suspense fallback={<div className="sheet-loading" role="status">Loading workspace...</div>}><HubSheet section={hubSection} onClose={() => setHubSection(null)} onToast={setToast} onRequestMagicLink={sendMagicLink} onSignOut={handleSignOut} dataMode={dataMode} notifications={notifications} onOpenNotification={openNotification} onMarkAllNotificationsRead={markEveryNotificationRead} primaryNavigation={<PrimaryNavigation activeView={activeView} settingsOpen onNavigate={changeView} onOpenSettings={openSettings} />} /></Suspense>}
        {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
      </section>
    </main>
  );
}

function LaunchAccessGate({
  status,
  authMessage,
  onRequestMagicLink,
  onPasswordSignIn,
  onSignOut,
}: {
  status: "loading" | "signed_out" | "no_access";
  authMessage?: string;
  onRequestMagicLink: (email: string) => Promise<void>;
  onPasswordSignIn: (email: string, password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordMode, setPasswordMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const paymentLink = academyPaymentLink();
  const checkoutNotice = checkoutReturnNotice(window.location.search);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || (passwordMode && !password)) return;
    setBusy(true);
    setMessage("");
    try {
      if (passwordMode) {
        await onPasswordSignIn(email.trim(), password);
      } else {
        await onRequestMagicLink(email.trim());
        setMessage("If this email has Academy access, a secure sign-in link is on the way.");
      }
    } catch {
      setMessage(passwordMode
        ? "Those credentials could not be verified. Check them and try again."
        : "The sign-in link could not be sent. Please try again.");
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
        <p className="launch-copy">{passwordMode
          ? "Sign in with the reusable credentials provided for review or support."
          : "Enter the email connected to your Academy membership. No password is needed."}</p>
        <form className="access-form" onSubmit={submit}>
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@company.com" autoComplete="email" inputMode="email" required /></label>
          {passwordMode && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>}
          <button className="primary-button wide" disabled={busy || !email.trim() || (passwordMode && !password)}>{busy ? (passwordMode ? "Signing in..." : "Sending...") : (passwordMode ? "Sign in" : "Email me a sign-in link")}</button>
        </form>
        <button className="launch-auth-switch" type="button" disabled={busy} onClick={() => { setPasswordMode((current) => !current); setPassword(""); setMessage(""); }}>
          {passwordMode ? "Email me a sign-in link instead" : "Use a password"}
        </button>
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
      {authMessage && <p className="launch-message" role="alert">{authMessage}</p>}
      <p className="launch-support">Need help? <a href="mailto:hello@dirtyturf.com">hello@dirtyturf.com</a></p>
      <nav className="launch-legal" aria-label="Privacy and support"><a href="/privacy.html">Privacy</a><a href="/support.html">Support</a><a href="/delete-account.html">Delete account</a></nav>
    </section>
  </main>;
}

function AcademyTabs({ activeView, canManage, onNavigate }: { activeView: Exclude<View, "home">; canManage: boolean; onNavigate: (view: View) => void }) {
  return <nav className={canManage ? "academy-tabs manage" : "academy-tabs"} aria-label="Academy sections">
    <button className={activeView === "learn" ? "active" : ""} aria-current={activeView === "learn" ? "page" : undefined} onClick={() => onNavigate("learn")}><BookOpen size={16} /> Courses</button>
    <button className={activeView === "community" ? "active" : ""} aria-current={activeView === "community" ? "page" : undefined} onClick={() => onNavigate("community")}><Users size={16} /> Community</button>
    <button className={activeView === "events" ? "active" : ""} aria-current={activeView === "events" ? "page" : undefined} onClick={() => onNavigate("events")}><CalendarDays size={16} /> Events</button>
    {canManage && <button className={activeView === "admin" ? "active" : ""} aria-current={activeView === "admin" ? "page" : undefined} onClick={() => onNavigate("admin")}><ShieldCheck size={16} /> Admin</button>}
  </nav>;
}

function HomeView({ jobs, openQuote, checks, setChecks, setToast }: { jobs: Job[]; openQuote: (mode: MeasurementMode) => void; checks: boolean[]; setChecks: React.Dispatch<React.SetStateAction<boolean[]>>; setToast: (message: string) => void }) {
  const latest = jobs[0];
  const historyPhotos = jobs.flatMap((job) => (job.photoItems ?? []).map((photo) => ({ ...photo, label: job.address }))).slice(0, 6);
  const checklist = ["Photograph problem areas", "Check seams and edges", "Confirm water access", "Log infill condition"];
  return (
    <div className="view-content home-view">
      <section className="field-hero">
        <div className="field-text"><p>Dirty Turf operator</p><h2>Measure it right. Quote the clean it actually needs.</h2><button className="hero-action" onClick={() => openQuote("camera")}><Camera size={17} /> Start measurement</button></div>
        <div className="field-scanner" aria-hidden="true"><div className="scanner-grid" /><div className="scanner-chip">{latest ? `${formatNumber(latest.area)} sq ft` : "Ready to measure"}</div><div className="scanner-pin one" /><div className="scanner-pin two" /><div className="scanner-pin three" /></div>
      </section>

      <nav className="quick-actions" aria-label="Primary tools">
        <Action icon={<Camera size={20} />} label="Camera measure" onClick={() => openQuote("camera")} />
        <Action icon={<Map size={20} />} label="Map trace" onClick={() => openQuote("map")} />
        <Action icon={<Package size={20} />} label="Infill calculator" onClick={() => openQuote("manual")} />
      </nav>

      <section className="tool-panel">
        {latest ? <>
          <div className="section-heading"><div><p>Latest estimate</p><h3>{latest.address}</h3></div><button className="ghost-button" onClick={() => openQuote("manual")}>New <Plus size={16} /></button></div>
          <div className="quote-grid"><Metric label="Area" value={formatNumber(latest.area)} suffix="sq ft" /><Metric label="Infill" value={String(latest.infill)} suffix="40-lb bags" /><Metric label="Price" value={formatCurrency(latest.quote)} suffix="customer" /></div>
          <div className="quote-line"><Ruler size={18} /><span>{measurementLabel(latest.method)} saved to property history.</span><Check size={18} /></div>
        </> : <div className="dashboard-empty"><Ruler size={24} /><div><p>First calculation</p><h3>No saved measurements yet</h3><span>Measure a yard to calculate infill bags and customer price.</span></div><button className="ghost-button" onClick={() => openQuote("manual")}>Start <Plus size={16} /></button></div>}
      </section>

      <section className="tool-list dashboard-tools" aria-label="Measurement tools">
        <ToolRow icon={<Camera size={20} />} title="Live camera measure" detail="Place AR points around the turf boundary" onClick={() => openQuote("camera")} />
        <ToolRow icon={<Map size={20} />} title="Map trace" detail="Outline a remote property before the visit" onClick={() => openQuote("map")} />
        <ToolRow icon={<Calculator size={20} />} title="Manual calculation" detail="Use known length and width" onClick={() => openQuote("manual")} />
      </section>
      <section className="checklist-panel dashboard-checklist">
        <div className="section-heading"><div><p>Arrival routine</p><h3>Property checklist</h3></div><span className="completion-count">{checks.filter(Boolean).length}/{checks.length}</span></div>
        {checklist.map((item, index) => <label className={checks[index] ? "check-row done" : "check-row"} key={item}><input type="checkbox" checked={checks[index]} onChange={() => setChecks((current) => current.map((checked, itemIndex) => itemIndex === index ? !checked : checked))} /><span className="custom-check"><Check size={14} /></span><span>{item}</span></label>)}
        <button className="secondary-button" onClick={() => setToast("Checklist saved for this visit.")}><ClipboardCheck size={17} /> Save checklist</button>
      </section>

      {historyPhotos.length > 0 && <section className="history-strip">
        <div className="section-heading compact"><div><p>Site history</p><h3>Photos by visit</h3></div><ImagePlus size={18} /></div>
        <div className="photo-row" aria-label="Past turf photos">{historyPhotos.map((photo, index) => <a className="photo-tile real-photo" href={photo.url} target="_blank" rel="noreferrer" key={`${photo.url}-${index}`}><img src={photo.url} alt={`${photo.label} visit`} /><span>{formatPhotoDate(photo.capturedAt)}</span><small>{photo.label}</small></a>)}</div>
      </section>}

      <section className="jobs"><div className="section-heading"><div><p>Pipeline</p><h3>Recent properties</h3></div><ClipboardList size={18} /></div>{jobs.slice(0, 4).map((job) => <JobRow job={job} key={job.id} />)}</section>
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

function QuoteSheet({ draft, setDraft, quote, photoUrl, setPhotoUrl, setPhotoFile, onClose, onSave, onError, primaryNavigation }: { draft: QuoteDraft; setDraft: React.Dispatch<React.SetStateAction<QuoteDraft>>; quote: QuoteTotals; photoUrl: string; setPhotoUrl: (url: string) => void; setPhotoFile: (file: File | null) => void; onClose: () => void; onSave: () => void | Promise<void>; onError: (message: string) => void; primaryNavigation: React.ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(dialogRef, onClose);
  const update = <K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const changePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("Choose a photo in JPEG, PNG, WebP, or HEIC format.");
      event.target.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      onError("Visit photos must be smaller than 20 MB.");
      event.target.value = "";
      return;
    }
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
  };
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
        {primaryNavigation}
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

function DesktopNavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? "desktop-nav-item active" : "desktop-nav-item"} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={label} title={label}>{icon}<span>{label}</span></button>; }
function numberValue(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US").format(value); }
function formatCurrency(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function measurementLabel(method: MeasurementMode) { return method === "camera" ? "Camera measurement" : method === "map" ? "Map trace" : "Manual measurement"; }
function formatPhotoDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Visit" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date); }

const rootElement = document.getElementById("root")!;
const appWindow = window as Window & { __dirtyTurfRoot?: ReturnType<typeof createRoot> };
appWindow.__dirtyTurfRoot ??= createRoot(rootElement);
const publicCertificateCode = new URLSearchParams(window.location.search).get("certificate");
appWindow.__dirtyTurfRoot.render(<AppErrorBoundary>{publicCertificateCode ? <CertificateVerificationPage code={publicCertificateCode} /> : <App />}</AppErrorBoundary>);

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
