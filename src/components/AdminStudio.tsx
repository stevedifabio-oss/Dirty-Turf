import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Award, BookOpen, BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronRight, CircleAlert, FilePlus2, GraduationCap, LayoutDashboard, LoaderCircle, Megaphone, Pencil, Pin, Plus, RefreshCw, Search, ShieldCheck, Upload, Users, X } from "lucide-react";
import { GrowthAdmin } from "./GrowthAdmin";
import { AdminMemberSetup } from "./AdminMemberSetup";
import { CommunityScheduler } from "./CommunityScheduler";
import { emptyQuizQuestion, existingQuizBody, quizEditorState, quizOptionsFor, serializeQuizQuestion, updateQuizQuestion, type QuizQuestionDraft } from "../lib/adminContent";
import { isLessonContentUrl, lessonContentBlocks, lessonContentBody, type LessonContentBlock } from "../lib/lessonContent";
import { LessonContentEditor } from "./LessonContentEditor";
import { memberAccessPresentation } from "../lib/memberPresentation";
import { useNativeNumberDrafts } from "../lib/useNativeNumberDrafts";
import {
  createAdminMember,
  issueAdminCertificate,
  loadAdminSnapshot,
  loadAdminLessonBlockMedia,
  moderateAdminPost,
  MemberInvitePartialFailure,
  removeAdminComment,
  revokeAdminCertificate,
  saveAdminCategory,
  saveAdminCourse,
  saveAdminEvent,
  saveAdminLesson,
  saveAdminModule,
  saveCertificateTemplate,
  setAdminMemberCourseAccess,
  updateAdminMember,
  updateAdminReport,
  uploadAdminLessonAsset,
  uploadAdminLessonBlockAsset,
  type AdminCourse,
  type AdminEvent,
  type AdminLesson,
  type AdminMember,
  type AdminModule,
  type AdminSnapshot,
  type AdminStatus,
  type CertificateTemplate,
} from "../lib/adminBackend";

import "./admin-studio.css";

type AdminTab = "overview" | "courses" | "community" | "events" | "members" | "certificates" | "services";

type Props = {
  onToast: (message: string) => void;
  onContentChange: () => void;
  onExit?: () => void;
  leaveGuardRef?: React.MutableRefObject<(() => boolean) | undefined>;
  readOnly?: boolean;
};

const DraftContext = createContext<React.MutableRefObject<Set<string>> | null>(null);

function useDraftGuard(dirty: boolean) {
  const drafts = useContext(DraftContext);
  const id = useId();
  useEffect(() => {
    if (dirty) drafts?.current.add(id);
    else drafts?.current.delete(id);
    return () => { drafts?.current.delete(id); };
  }, [dirty, drafts, id]);
}

function confirmDiscard(drafts: React.MutableRefObject<Set<string>> | null) {
  return !drafts?.current.size || window.confirm("You have unsaved changes. Leave this editor and discard them?");
}

export function AdminStudio({ onToast, onContentChange, onExit, leaveGuardRef, readOnly = false }: Props) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const actionPending = useRef(false);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const drafts = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSnapshot(await loadAdminSnapshot());
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!leaveGuardRef) return;
    const guard = () => !actionPending.current && confirmDiscard(drafts);
    leaveGuardRef.current = guard;
    return () => { if (leaveGuardRef.current === guard) leaveGuardRef.current = undefined; };
  }, [leaveGuardRef]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (drafts.current.size) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, []);

  const act: ActionRunner = async (label, action, success, contentChanged = true) => {
    if (actionPending.current || readOnlyRef.current) return false;
    actionPending.current = true;
    setActionError("");
    setBusy(label);
    try {
      await action();
      const refreshed = await refresh();
      if (contentChanged) onContentChange();
      onToast(refreshed ? success : `${success} The list could not refresh. Use Refresh to see the saved change.`);
      return true;
    } catch (caught) {
      if (caught instanceof MemberInvitePartialFailure) await refresh();
      setActionError(errorMessage(caught));
      onToast(errorMessage(caught));
      return false;
    } finally {
      actionPending.current = false;
      setBusy("");
    }
  };
  const navigate = (next: AdminTab) => {
    if (next !== tab && !busy && confirmDiscard(drafts)) setTab(next);
  };

  if (loading && !snapshot) return <div className="admin-loading" role="status"><LoaderCircle className="spin" size={24} /> Loading your admin workspace…</div>;
  if (!snapshot) return <div className="view-content admin-view"><div className="empty-state"><CircleAlert size={24} /><h3>Admin workspace could not load</h3><p>{error || "Your administrator access could not be verified."}</p><button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={16} /> Try again</button></div></div>;

  const openReports = snapshot.reports.filter((report) => ["open", "reviewing"].includes(report.status)).length;
  const draftCourses = snapshot.courses.filter((course) => course.status === "draft").length;
  const pendingInvites = snapshot.members.filter((member) => memberAccessPresentation(member).needsReview).length;
  const sections = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "courses", label: "Courses", icon: BookOpen },
    { id: "members", label: "Members", icon: Users },
    { id: "community", label: "Community", icon: Megaphone },
    { id: "events", label: "Events", icon: CalendarDays },
    { id: "certificates", label: "Certificates", icon: Award },
    { id: "services", label: "Offers & services", icon: BriefcaseBusiness },
  ] as const;

  return <DraftContext.Provider value={drafts}><div className="view-content admin-view"><fieldset className="admin-workspace-fields" disabled={readOnly || Boolean(busy)}>
    <header className="admin-hero">
      <div><p><ShieldCheck size={15} /> Academy management</p><h2>Your admin workspace</h2><span>{snapshot.communityName}</span></div>
      <div className="admin-header-actions">{onExit && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => { if (leaveGuardRef || confirmDiscard(drafts)) onExit(); }}><BookOpen size={16} /> View Academy</button>}<button className="admin-refresh secondary-button" aria-label="Refresh admin workspace" disabled={loading || Boolean(busy)} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} size={16} /> <span>{loading ? "Refreshing…" : "Refresh"}</span></button></div>
    </header>
    <nav className="admin-tabs" aria-label="Admin sections">
      {sections.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={tab === id ? "page" : undefined} className={tab === id ? "active" : ""} disabled={Boolean(busy)} onClick={() => navigate(id)}><Icon size={17} /><span>{label}</span>{id === "community" && openReports > 0 && <span className="admin-nav-count" aria-label={`${openReports} open reports`}>{openReports}</span>}</button>)}
    </nav>
    {error && <div className="admin-feedback" role="alert"><CircleAlert size={19} /><span><strong>The latest data could not load.</strong> {error} Your open editor is still here.</span><button type="button" disabled={loading || Boolean(busy)} onClick={() => void refresh()}>Try again</button></div>}
    {actionError && <div className="admin-feedback" role="alert"><CircleAlert size={19} /><span>{actionError}</span><button type="button" aria-label="Dismiss action error" onClick={() => setActionError("")}><X size={17} /></button></div>}

    {tab === "overview" && <section className="admin-panel">
      <SectionHeading icon={<LayoutDashboard size={20} />} title="Academy at a glance" detail="Create training, help members, and keep the community running." />
      <div className="admin-metrics">
        <Metric icon={<BookOpen />} value={snapshot.courses.length} label="Courses" detail={`${draftCourses} ${draftCourses === 1 ? "draft" : "drafts"}`} />
        <Metric icon={<Users />} value={snapshot.members.length} label="Members" detail={`${pendingInvites} need access review`} />
        <Metric icon={<Megaphone />} value={snapshot.posts.length} label="Recent posts" detail={`${openReports} open reports`} />
        <Metric icon={<Award />} value={snapshot.certificates.length} label="Certificates" detail={`${snapshot.quizAttemptCount} quiz attempts`} />
      </div>
      <div className="admin-overview-grid">
        <section className="admin-start"><div className="admin-card-heading"><h3>What would you like to do?</h3><p>Your everyday admin tools, in one place.</p></div>
          <button onClick={() => navigate("courses")}><span className="admin-action-icon"><BookOpen size={21} /></span><span><strong>Build your courses</strong><small>Add videos, text, photos, links and quizzes.</small></span><ArrowRight size={19} /></button>
          <button onClick={() => navigate("members")}><span className="admin-action-icon"><Users size={21} /></span><span><strong>Manage member access</strong><small>Find members, review accounts and assign courses.</small></span><ArrowRight size={19} /></button>
          <button onClick={() => navigate("events")}><span className="admin-action-icon"><CalendarDays size={21} /></span><span><strong>Plan a live session</strong><small>Create an event and add the meeting details.</small></span><ArrowRight size={19} /></button>
        </section>
        <section className="admin-launch-checks"><div className="admin-card-heading"><h3>Needs your attention</h3><p>Workspace checks to review before inviting members.</p></div>
          <StatusRow complete={pendingInvites === 0} label={pendingInvites ? `${pendingInvites} member accounts need review` : "Member account review is clear"} />
          <StatusRow complete={openReports === 0} label={openReports ? `${openReports} moderation reports to review` : "No unresolved moderation reports"} />
          <StatusRow complete={snapshot.categories.some((category) => category.name.toLowerCase() === "announcements" && !category.memberCanPost)} label="Announcements restricted to admins" />
          <StatusRow complete={snapshot.templates.some((template) => template.active)} label="Active certificate template" />
        </section>
      </div>
      <div className="admin-migration-note"><ShieldCheck size={21} /><div><strong>Moving from GoHighLevel</strong><p>Prepare accounts and test with a small group before inviting everyone. Keep discussions in GoHighLevel until your agreed switch date; native community activity does not sync automatically.</p></div><button className="secondary-button" onClick={() => navigate("members")}>Review members <ArrowRight size={16} /></button></div>
    </section>}

    {tab === "courses" && <CoursesAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "community" && <CommunityAdmin snapshot={snapshot} busy={busy} act={act} readOnly={readOnly} />}
    {tab === "events" && <EventsAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "members" && <MembersAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "certificates" && <CertificatesAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "services" && <GrowthAdminBridge communityId={snapshot.communityId} readOnly={readOnly} onToast={onToast} />}
  </fieldset></div></DraftContext.Provider>;
}

function GrowthAdminBridge(props: { communityId: string; readOnly: boolean; onToast: (message: string) => void }) {
  const [dirty, setDirty] = useState(false);
  useDraftGuard(dirty);
  return <GrowthAdmin {...props} onDirtyChange={setDirty} />;
}

function CoursesAdmin({ snapshot, busy, act }: AdminSectionProps) {
  const [editor, setEditor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(snapshot.courses[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminStatus | "all">("all");
  const [lessonSearch, setLessonSearch] = useState("");
  const detailRef = useRef<HTMLDivElement>(null);
  const drafts = useContext(DraftContext);
  const selected = snapshot.courses.find((course) => course.id === selectedId);
  const editing = snapshot.courses.find((course) => course.id === editor) ?? null;
  const visible = snapshot.courses.filter((course) => (statusFilter === "all" || course.status === statusFilter) && `${course.title} ${course.category}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const lessons = selected?.modules.flatMap((module) => module.lessons) ?? [];
  const publishedLessons = selected?.modules.filter(module => !hiddenSourceModule(module)).flatMap(module => module.lessons).filter(lesson => lesson.status === "published").length ?? 0;
  const query = lessonSearch.trim().toLocaleLowerCase();
  const modules = selected?.modules.filter((module) => !query || `${module.title} ${module.groupTitle}`.toLocaleLowerCase().includes(query) || module.lessons.some((lesson) => lesson.title.toLocaleLowerCase().includes(query))) ?? [];
  const closeEditor = () => { if (confirmDiscard(drafts)) setEditor(null); };
  const openEditor = (id: string) => { if (confirmDiscard(drafts)) setEditor(id); };
  return <section className="admin-panel">
    <div className="admin-section-toolbar"><SectionHeading icon={<GraduationCap size={21} />} title="Courses" detail="Build training here. Draft first, then publish when it’s ready." /><button className="primary-button" disabled={Boolean(busy)} onClick={() => openEditor("new")}><Plus size={18} /> New course</button></div>
    <div className="admin-course-workspace">
      <aside className="admin-course-library" aria-label="Course library">
        <div className="admin-library-heading"><h4>Course library</h4><span>{snapshot.courses.length}</span></div>
        <SearchField label="Search courses" value={search} onChange={setSearch} placeholder="Search courses…" />
        <label className="admin-filter-label">Show<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AdminStatus | "all")}><option value="all">All courses</option><option value="draft">Drafts</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
        <div className="admin-course-options">{visible.map((course) => <button type="button" key={course.id} aria-current={selectedId === course.id && !editor ? "true" : undefined} className={selectedId === course.id && !editor ? "selected" : ""} disabled={Boolean(busy)} onClick={() => { if (confirmDiscard(drafts)) { setSelectedId(course.id); setEditor(null); setLessonSearch(""); if ((detailRef.current?.closest(".admin-view")?.clientWidth ?? Infinity) <= 720) detailRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); } }}><span className="admin-course-option-meta"><StatusBadge status={course.status} /><small>{course.category}</small></span><strong>{course.title}</strong><span className="admin-course-option-bottom"><small>{course.modules.length} modules · {course.modules.reduce((total, module) => total + module.lessons.length, 0)} lessons</small><ChevronRight size={17} /></span></button>)}</div>
        {!visible.length && <EmptyAdmin text={snapshot.courses.length ? "No courses match. Try another search or status." : "Your first course starts with New course."} />}
      </aside>
      <div className="admin-course-detail" ref={detailRef}>
        {editor ? <CourseForm key={editor} course={editing} nextOrder={nextSortOrder(snapshot.courses)} busy={busy} onCancel={closeEditor} onSave={async (course) => { let savedId = ""; const saved = await act("course", async () => { savedId = await saveAdminCourse(course); }, course.id ? "Course updated." : "Draft course created. Add your first module."); if (saved) { setSelectedId(savedId); setEditor(null); setSearch(""); setStatusFilter("all"); } return saved; }} /> : selected ? <>
          <header className="admin-course-heading"><div className="admin-course-eyebrow"><StatusBadge status={selected.status} /><span>{selected.category}</span></div><h3>{selected.title}</h3>{selected.description && <p>{selected.description}</p>}<div className="admin-course-summary"><span><BookOpen size={15} /> {selected.modules.length} modules</span><span>{lessons.length} lessons</span><span>{publishedLessons} published lessons</span></div><div className="admin-inline-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => openEditor(selected.id)}><Pencil size={16} /> Course settings</button>{selected.status !== "published" && <button className="primary-button" disabled={Boolean(busy) || publishedLessons === 0} onClick={() => { if (confirmDiscard(drafts) && window.confirm(`Publish “${selected.title}”? Members with access will see its published lessons.`)) void act("publish-course", () => saveAdminCourse({ ...selected, status: "published" }), "Course published."); }}><Check size={16} /> Publish course</button>}{selected.status === "published" && <button className="admin-text-action" disabled={Boolean(busy)} onClick={() => { if (confirmDiscard(drafts) && window.confirm(`Archive “${selected.title}”? It will no longer be available to members. Progress is kept.`)) void act("archive-course", () => saveAdminCourse({ ...selected, status: "archived" }), "Course archived."); }}>Archive course</button>}</div>{selected.status !== "published" && publishedLessons === 0 && <p className="admin-form-note">Add and publish at least one lesson before publishing this course.</p>}</header>
          <div className="admin-curriculum-heading"><div><h4>Course content</h4><p>Modules group your lessons. Each lesson can include videos, text, photos and links.</p></div></div>
          <SearchField label="Find a module or lesson" value={lessonSearch} onChange={(value) => { if (confirmDiscard(drafts)) setLessonSearch(value); }} placeholder="Find a module or lesson…" />
          <ModuleComposer key={selected.id} courseId={selected.id} nextOrder={nextSortOrder(selected.modules)} busy={busy} act={act} />
          <div className="admin-module-list">{modules.map((module) => <ModuleEditor key={`${selected.id}-${module.id}`} module={module} courseId={selected.id} query={query} busy={busy} act={act} />)}</div>
          {!modules.length && <EmptyAdmin text={query ? "No matching modules or lessons. Try another search." : "No modules yet. Add your first module, then create its lessons."} />}
        </> : <div className="admin-course-empty"><BookOpen size={34} /><h3>Build your next course</h3><p>Create a draft, add modules and lessons, then publish it for members.</p><button className="primary-button" onClick={() => openEditor("new")}><Plus size={17} /> Create a course</button></div>}
      </div>
    </div>
  </section>;
}

function CourseForm({ course, nextOrder, busy, onCancel, onSave }: { course: AdminCourse | null; nextOrder: number; busy: string; onCancel: () => void; onSave: (course: Partial<AdminCourse> & Pick<AdminCourse, "title">) => Promise<boolean> }) {
  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [category, setCategory] = useState(course?.category ?? "Core");
  const [instructorName, setInstructorName] = useState(course?.instructorName ?? "Steve DiFabio");
  const initialAccessType = course?.accessType ?? "purchase";
  const initialPrice = (course?.priceCents ?? (course ? 0 : 14995)) / 100;
  const [accessType, setAccessType] = useState<AdminCourse["accessType"]>(initialAccessType);
  const [requiredLevel, setRequiredLevel] = useState(course?.requiredLevel ?? 1);
  const [priceDollars, setPriceDollars] = useState(initialPrice);
  const [status, setStatus] = useState<AdminStatus>(course?.status ?? "draft");
  const numberDraft = useNativeNumberDrafts();
  const dirty = title !== (course?.title ?? "") || description !== (course?.description ?? "") || category !== (course?.category ?? "Core") || instructorName !== (course?.instructorName ?? "Steve DiFabio") || accessType !== initialAccessType || requiredLevel !== (course?.requiredLevel ?? 1) || priceDollars !== initialPrice || status !== (course?.status ?? "draft");
  useDraftGuard(dirty);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    if (status === "published" && course?.status !== "published" && !window.confirm(`Publish “${title.trim()}”? Members with access will see its published lessons.`)) return;
    void onSave({ id: course?.id, title, description, category, instructorName, accessType, requiredLevel, priceCents: accessType === "purchase" ? Math.max(0, Math.round(priceDollars * 100)) : null, status, sortOrder: course?.sortOrder ?? nextOrder });
  };
  return <section className="admin-editor-card"><div className="admin-editor-heading"><div><small>{course ? "Course settings" : "New course"}</small><h3>{course ? "Edit course details" : "Start with the basics"}</h3><p>{course ? "Update how this course appears in the Academy." : "Save a draft to start adding your modules and lessons."}</p></div><button type="button" className="icon-button" aria-label="Close course settings" disabled={Boolean(busy)} onClick={onCancel}><X size={19} /></button></div>
    <form onSubmit={submit}>
      <label>Course title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="e.g. Professional Turf Cleaning" required /></label>
      <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="What will members learn?" /></label>
      <div className="admin-form-grid"><label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} /></label><label>Instructor<input value={instructorName} onChange={(event) => setInstructorName(event.target.value)} /></label></div>
      <div className="admin-form-grid"><label>Access<select value={accessType} onChange={(event) => setAccessType(event.target.value as AdminCourse["accessType"])}><option value="open">Included for members with access</option><option value="level">Required member level</option><option value="purchase">Separate purchase / assignment</option></select></label>{accessType === "level" && <label>Required level<input type="number" min="1" step="1" {...numberDraft("level", requiredLevel, setRequiredLevel)} required /></label>}{accessType === "purchase" && <label>Price (USD)<input type="number" min="0" step="0.01" {...numberDraft("price", priceDollars, setPriceDollars)} required /></label>}</div>
      {accessType === "purchase" && <p className="admin-form-note">Additional courses are a separate one-time purchase. This listed price does not activate checkout; connect a payment offer before selling the course. Prior member access is preserved.</p>}
      {course && <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as AdminStatus)}><option value="draft">Draft</option><option value="published" disabled={!course.modules.some((module) => !hiddenSourceModule(module) && module.lessons.some((lesson) => lesson.status === "published"))}>Published</option><option value="archived">Archived</option></select></label>}
      <div className="admin-form-actions"><button className="primary-button" disabled={Boolean(busy) || !title.trim()}>{busy === "course" ? <><LoaderCircle size={17} className="spin" /> Saving…</> : <><Check size={17} /> {course ? "Save changes" : "Create draft course"}</>}</button><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={onCancel}>Cancel</button></div>
    </form>
  </section>;
}

function ModuleEditor({ module, courseId, query, busy, act }: { module: AdminModule; courseId: string; query: string; busy: string; act: ActionRunner }) {
  const [editing, setEditing] = useState(false);
  const drafts = useContext(DraftContext);
  const matchingModule = `${module.title} ${module.groupTitle}`.toLocaleLowerCase().includes(query);
  const lessons = module.lessons.filter((lesson) => !query || matchingModule || lesson.title.toLocaleLowerCase().includes(query));
  const hidden = hiddenSourceModule(module);
  const editingBusy = busy || (hidden ? "hidden-source-module" : "");
  return <details className="admin-module" open={query || !module.lessons.length ? true : undefined}><summary className="admin-module-heading"><span className="admin-module-index">{module.sortOrder + 1}</span><span><small>{hidden ? module.memberVisibility === "source-archived" ? "Archived module · hidden from members" : "Source module · hidden from members" : module.groupTitle || "Module"}</small><strong>{module.title}</strong></span><span className="admin-module-count">{module.lessons.length} {module.lessons.length === 1 ? "lesson" : "lessons"}</span><ChevronDown size={18} /></summary><div className="admin-module-content">{hidden ? <p className="admin-form-note" role="status">{module.memberVisibility === "source-archived" ? "This imported module was archived and is hidden from members." : "This imported module is hidden in GoHighLevel."} Use Add module above to create new member lessons here.</p> : <div className="admin-inline-actions"><button className="admin-text-action" disabled={Boolean(busy)} onClick={() => { if (!editing || confirmDiscard(drafts)) setEditing((value) => !value); }}><Pencil size={15} /> {editing ? "Close module settings" : "Edit module"}</button></div>}{editing && !hidden && <ModuleComposer key={`${module.id}-${module.title}`} module={module} courseId={courseId} nextOrder={module.sortOrder} busy={busy} act={act} onSaved={() => setEditing(false)} />}
      <div className="admin-lesson-list">{lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} courseId={courseId} busy={editingBusy} act={act} />)}</div>
      {!module.lessons.length && !hidden && <p className="admin-muted">Your module is ready. Add a lesson below, then fill it with videos, text, photos or links.</p>}
      {!hidden && <LessonComposer courseId={courseId} moduleId={module.id} nextOrder={nextSortOrder(module.lessons)} busy={busy} act={act} />}
    </div></details>;
}

function hiddenSourceModule(module: AdminModule) {
  return module.memberVisibility === "source-hidden" || module.memberVisibility === "source-archived";
}

function ModuleComposer({ courseId, nextOrder, busy, act, module, onSaved }: { courseId: string; nextOrder: number; busy: string; act: ActionRunner; module?: AdminModule; onSaved?: () => void }) {
  const [title, setTitle] = useState(module?.title ?? "");
  const [groupTitle, setGroupTitle] = useState(module?.groupTitle ?? "");
  useDraftGuard(title !== (module?.title ?? "") || groupTitle !== (module?.groupTitle ?? ""));
  return <details className="admin-subcomposer" open={module ? true : undefined}><summary><Plus size={16} /> {module ? "Module settings" : "Add module"}</summary><form onSubmit={(event) => { event.preventDefault(); if (!title.trim() || busy) return; void act("module", () => saveAdminModule({ id: module?.id, courseId, title, groupTitle, sortOrder: module?.sortOrder ?? nextOrder, dripAfterDays: module?.dripAfterDays ?? null }), module ? "Module updated." : "Module added.").then((saved) => { if (saved) { if (!module) { setTitle(""); setGroupTitle(""); } onSaved?.(); } }); }}><div className="admin-form-grid"><label>Module name<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Equipment and setup" required /></label><label>Section label (optional)<input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="e.g. Getting started" /></label></div><button className="secondary-button" disabled={Boolean(busy) || !title.trim()}><Plus size={16} /> {busy === "module" ? "Saving…" : module ? "Save module" : "Add module"}</button></form></details>;
}

function LessonComposer({ courseId, moduleId, nextOrder, busy, act, lesson, onSaved, onCancel }: { courseId: string; moduleId: string; nextOrder: number; busy: string; act: ActionRunner; lesson?: AdminLesson; onSaved?: () => void; onCancel?: () => void }) {
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [lessonType, setLessonType] = useState<AdminLesson["lessonType"]>(lesson?.lessonType ?? "guide");
  const initialContent = useMemo(() => {
    try { return { blocks: lessonContentBlocks(lesson?.body), error: "" }; }
    catch { return { blocks: [] as LessonContentBlock[], error: "This lesson’s saved content needs review. It has been kept unchanged; saving is disabled to protect it." }; }
  }, [lesson?.body]);
  const initialBlocks = initialContent.blocks;
  const [blocks, setBlocks] = useState<LessonContentBlock[]>(initialBlocks);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [localFiles, setLocalFiles] = useState<Record<string, string>>({});
  const [savedMedia, setSavedMedia] = useState<Record<string, string>>({});
  const [mediaError, setMediaError] = useState("");
  const [formError, setFormError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const draftId = useRef(lesson?.id);
  const uploaded = useRef(new Map<string, { file: File; path: string }>());
  const composerRef = useRef<HTMLDetailsElement>(null);
  const [videoUrl, setVideoUrl] = useState(lesson?.videoUrl ?? "");
  const [durationMinutes, setDurationMinutes] = useState(Math.round((lesson?.durationSeconds ?? 0) / 60));
  const [status, setStatus] = useState<AdminStatus>(lesson?.status ?? "draft");

  const initialQuiz = useMemo(() => quizEditorState(lesson?.body), [lesson?.body]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionDraft[]>(initialQuiz.questions);
  const [passingPercent, setPassingPercent] = useState(initialQuiz.passingPercent);
  const numberDraft = useNativeNumberDrafts();
  useDraftGuard(title !== (lesson?.title ?? "") || JSON.stringify(blocks) !== JSON.stringify(initialBlocks) || Object.keys(files).length > 0 || videoUrl !== (lesson?.videoUrl ?? "") || lessonType !== (lesson?.lessonType ?? "guide") || durationMinutes !== Math.round((lesson?.durationSeconds ?? 0) / 60) || status !== (lesson?.status ?? "draft") || JSON.stringify(quizQuestions.map(serializeQuizQuestion)) !== JSON.stringify(initialQuiz.questions.map(serializeQuizQuestion)) || passingPercent !== initialQuiz.passingPercent);
  useEffect(() => {
    const urls = Object.fromEntries(Object.entries(files).map(([id, file]) => [id, URL.createObjectURL(file)]));
    setLocalFiles(urls);
    return () => { Object.values(urls).forEach(url => URL.revokeObjectURL(url)); };
  }, [files]);
  useEffect(() => {
    if (!lesson?.id) return;
    let stopped = false;
    void loadAdminLessonBlockMedia(courseId, lesson.id).then(media => { if (!stopped) setSavedMedia(media); }).catch(() => { if (!stopped) setMediaError("Saved media previews could not load. Your lesson files are kept."); });
    return () => { stopped = true; };
  }, [courseId, lesson?.id]);
  const localMedia = Object.fromEntries(blocks.flatMap(block => {
    const source = localFiles[block.id] || ("url" in block ? savedMedia[block.url] : undefined);
    return source ? [[block.id, source]] : [];
  }));
  const changeFile = (id: string, file: File | undefined) => setFiles(current => { const next = { ...current }; if (file) next[id] = file; else delete next[id]; return next; });
  const quizIsValid = quizQuestions.length > 0 && quizQuestions.every((question) => question.prompt.trim() && quizOptionsFor(question).length >= 2 && Number.isInteger(question.correctOption) && question.correctOption >= 1 && question.correctOption <= quizOptionsFor(question).length);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy || initialContent.error || (lessonType === "quiz" && !quizIsValid)) return;
    setFormError("");
    if (lessonType === "quiz" && (!Number.isInteger(passingPercent) || passingPercent < 1 || passingPercent > 100)) { setFormError("Choose a passing score from 1 to 100."); return; }
    for (const [index, block] of blocks.entries()) {
      if (block.type === "legacy") continue;
      if (block.type === "text" && !block.text.trim()) { setFormError(`Add text to block ${index + 1}, or remove the empty block.`); return; }
      if ("url" in block && !files[block.id] && !isLessonContentUrl(block.url)) { setFormError(`Add a valid link or upload to block ${index + 1}.`); return; }
      if (block.type === "image" && !block.alt.trim()) { setFormError(`Describe the photo in block ${index + 1}.`); return; }
      if (block.type === "link" && !block.label.trim()) { setFormError(`Add link text to block ${index + 1}.`); return; }
    }
    if (status === "published" && !blocks.length && !videoUrl && lessonType !== "quiz") { setFormError("Add some lesson content before publishing."); return; }
    if (videoUrl !== (lesson?.videoUrl ?? "") && videoUrl && !isLessonContentUrl(videoUrl)) { setFormError("Use a valid video link."); return; }
    const saved = await act("lesson", async () => {
      const lessonValues = { moduleId, title, lessonType: lessonType === "quiz" ? "quiz" as const : blocks.some(block => block.type === "video") || videoUrl ? "video" as const : "guide" as const, transcript: lesson?.transcript ?? "", resources: lesson?.resources ?? [], durationSeconds: Math.max(0, durationMinutes * 60), sortOrder: lesson?.sortOrder ?? nextOrder };
      const pendingFiles = Object.entries(files).filter(([id]) => blocks.some(block => block.id === id));
      // Persist a private draft first so uploads have a stable lesson owner.
      // Keep that ID and successful uploads on failure so retry cannot duplicate them.
      if (!draftId.current && pendingFiles.length) draftId.current = await saveAdminLesson({ ...lessonValues, body: {}, videoUrl: "", status: "draft" });
      let resolved = [...blocks];
      for (const [id, file] of pendingFiles) {
        let asset = uploaded.current.get(id);
        if (!asset || asset.file !== file) {
          setUploadStatus(`Uploading ${file.name}…`);
          const result = await uploadAdminLessonBlockAsset(file, courseId, draftId.current!);
          asset = { file, path: result.path };
          uploaded.current.set(id, asset);
          if (result.previewUrl) setSavedMedia(current => ({ ...current, [`academy-asset:${result.path}`]: result.previewUrl }));
        }
        resolved = resolved.map(block => block.id === id && "url" in block ? { ...block, url: `academy-asset:${asset.path}` } : block);
      }
      const body = lessonContentBody(lesson?.body, resolved);
      if (lessonType === "quiz") body.quiz = { ...existingQuizBody(lesson?.body), name: title.trim(), requiresPassing: true, passingPercent, questions: quizQuestions.map(serializeQuizQuestion) };
      else delete body.quiz;
      setUploadStatus("Saving lesson…");
      draftId.current = await saveAdminLesson({ ...lessonValues, id: draftId.current, body, videoUrl, status });
    }, lesson ? "Lesson updated." : "Lesson added.");
    setUploadStatus("");
    if (saved) {
      if (!lesson) { setTitle(""); setBlocks([]); setFiles({}); setVideoUrl(""); setQuizQuestions(initialQuiz.questions); setPassingPercent(initialQuiz.passingPercent); setDurationMinutes(0); setStatus("draft"); setLessonType("guide"); draftId.current = undefined; uploaded.current.clear(); if (composerRef.current) composerRef.current.open = false; }
      onSaved?.();
    } else if (!lesson && draftId.current) setFormError("Your draft is kept. Save again to finish uploading and saving this lesson.");
  };
  return <details ref={composerRef} className="admin-subcomposer admin-lesson-composer" open={lesson ? true : undefined}><summary><FilePlus2 size={16} /> {lesson ? "Edit lesson" : "Add lesson"}</summary><form onSubmit={(event) => void submit(event)}>
    <p className="admin-muted">Give the lesson a name, then add its content below. Save a draft to keep a new lesson private. Published lessons update when you save.</p>
    <div className="admin-form-grid"><label>Lesson title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Choosing the right equipment" required /></label><label>Type<select value={lessonType === "quiz" ? "quiz" : "guide"} onChange={(event) => setLessonType(event.target.value as AdminLesson["lessonType"])}><option value="guide">Lesson · mixed content</option><option value="quiz">Quiz</option></select></label></div>
    {initialContent.error && <p className="admin-form-error" role="alert">{initialContent.error}</p>}
    <LessonContentEditor blocks={blocks} files={files} localMedia={localMedia} disabled={Boolean(busy) || Boolean(initialContent.error)} onChange={setBlocks} onFileChange={changeFile} />
    {mediaError && <p className="admin-form-note" role="status">{mediaError}</p>}
    {lesson?.videoUrl && (lesson.videoUrl.startsWith("academy-asset:") ? <div className="lesson-saved-media"><span>{videoUrl ? "Your existing main video is kept." : "Your existing main video will be removed when you save."}</span><button type="button" disabled={Boolean(busy)} onClick={() => setVideoUrl(videoUrl ? "" : lesson.videoUrl)}>{videoUrl ? "Remove existing video" : "Keep existing video"}</button></div> : <label>Existing main video<input type="url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://..." /></label>)}
    {lessonType === "quiz" && <div className="admin-quiz-builder">
      {quizQuestions.map((question, index) => <div className="admin-quiz-question" key={question.id}>
        <div className="admin-quiz-question-heading"><strong>Question {index + 1}</strong>{quizQuestions.length > 1 && <button type="button" onClick={() => setQuizQuestions((current) => current.filter((item) => item.id !== question.id))}>Remove</button>}</div>
        <label>Question<input value={question.prompt} onChange={(event) => setQuizQuestions((current) => updateQuizQuestion(current, question.id, { prompt: event.target.value }))} required /></label>
        <label>Answer choices<textarea rows={4} value={question.optionLines} onChange={(event) => setQuizQuestions((current) => updateQuizQuestion(current, question.id, { optionLines: event.target.value }))} placeholder={'One choice per line'} required /></label>
        <div className="admin-form-grid"><label>Correct choice number<input type="number" min="1" max={Math.max(1, quizOptionsFor(question).length)} {...numberDraft(`choice-${question.id}`, question.correctOption, value => setQuizQuestions(current => updateQuizQuestion(current, question.id, { correctOption: value })))} required /></label><label>Answer explanation<input value={question.explanation} onChange={(event) => setQuizQuestions((current) => updateQuizQuestion(current, question.id, { explanation: event.target.value }))} placeholder="Shown after submitting" /></label></div>
      </div>)}
      <button type="button" className="secondary-button" onClick={() => setQuizQuestions((current) => [...current, emptyQuizQuestion()])}><Plus size={15} /> Add question</button>
      <label>Passing score<input type="number" min="1" max="100" {...numberDraft("passing", passingPercent, setPassingPercent)} /></label>
      {!quizIsValid && <p className="admin-form-error">Every quiz needs a question, at least two choices, and a valid correct-choice number.</p>}
    </div>}
    <div className="admin-form-grid"><label>Minutes<input type="number" min="0" {...numberDraft("minutes", durationMinutes, setDurationMinutes)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as AdminStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>
    <p className="admin-form-note">Draft lessons stay private. Published lessons appear in a published course for members with access.</p>
    {formError && <p className="admin-form-error" role="alert">{formError}</p>}
    {uploadStatus && <p className="lesson-upload-status" role="status"><LoaderCircle className="spin" size={16} /> {uploadStatus}</p>}
    <div className="admin-form-actions"><button className="primary-button" disabled={Boolean(busy) || !title.trim() || Boolean(initialContent.error) || (lessonType === "quiz" && !quizIsValid)}><Check size={16} /> {busy === "lesson" ? "Saving…" : "Save lesson"}</button>{onCancel && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={onCancel}>Cancel edit</button>}</div>
  </form></details>;
}

function LessonRow({ lesson, courseId, busy, act }: { lesson: AdminLesson; courseId: string; busy: string; act: ActionRunner }) {
  const [editing, setEditing] = useState(false);
  const drafts = useContext(DraftContext);
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || editing) return;
    const uploaded = await act(`asset-${lesson.id}`, () => uploadAdminLessonAsset(file, courseId, lesson.id), "Lesson file uploaded.");
    if (uploaded) event.target.value = "";
  };
  return <div className="admin-lesson">
    <span><strong>{lesson.title}</strong><small><StatusBadge status={lesson.status} /> {lesson.lessonType} · {Math.round(lesson.durationSeconds / 60)} min</small></span>
    <div><button aria-label={`Edit ${lesson.title}`} disabled={Boolean(busy)} onClick={() => { if (!editing || confirmDiscard(drafts)) setEditing((value) => !value); }}><Pencil size={15} /> {editing ? "Close" : "Edit"}</button><label className="admin-upload-button" title={editing ? "Save or close this editor before adding a download." : "Add a PDF, Word document or audio download up to 20 MB."}><Upload size={15} /><span>{busy === `asset-${lesson.id}` ? "Uploading…" : "Add download"}</span><input aria-label={`Upload file for ${lesson.title}`} type="file" accept="audio/*,.pdf,.doc,.docx" disabled={Boolean(busy) || editing} onChange={(event) => void upload(event)} /></label></div>
    {editing && <LessonComposer lesson={lesson} courseId={courseId} moduleId={lesson.moduleId} nextOrder={lesson.sortOrder} busy={busy} act={act} onSaved={() => setEditing(false)} onCancel={() => { if (confirmDiscard(drafts)) setEditing(false); }} />}
  </div>;
}

function CommunityAdmin({ snapshot, busy, act, readOnly }: AdminSectionProps & { readOnly?: boolean }) {
  const [categoryName, setCategoryName] = useState("");
  const [scheduleDirty, setScheduleDirty] = useState(false);
  useDraftGuard(scheduleDirty);
  return <section className="admin-panel">
    <SectionHeading icon={<Megaphone size={19} />} title="Community and moderation" detail="Control channels, announcements, pinned posts, and member reports." />
    <CommunityScheduler communityId={snapshot.communityId} categories={snapshot.categories} members={snapshot.members} readOnly={readOnly} onDirtyChange={setScheduleDirty} onRun={(label, action, success) => act(label, action, success, false)} />
    <details className="admin-composer"><summary><Plus size={16} /> Add channel</summary><form onSubmit={(event) => { event.preventDefault(); if (!categoryName.trim()) return; void act("category", () => saveAdminCategory({ name: categoryName, sortOrder: snapshot.categories.length }), "Channel created.").then((saved) => { if (saved) setCategoryName(""); }); }}><label>Channel name<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} maxLength={40} required /></label><button className="secondary-button" disabled={busy === "category"}><Plus size={15} /> Add channel</button></form></details>
    <div className="admin-channel-list">{snapshot.categories.map((category) => <div key={category.id}><span><strong>{category.name}</strong><small>{category.memberCanPost ? "Members can post" : "Admins only"}</small></span><button disabled={busy === `category-${category.id}`} onClick={() => void act(`category-${category.id}`, () => saveAdminCategory({ ...category, memberCanPost: !category.memberCanPost }), category.memberCanPost ? `${category.name} is now admin-only.` : `Members can now post in ${category.name}.`)}>{category.memberCanPost ? "Restrict" : "Allow members"}</button></div>)}</div>
    <h3 className="admin-list-title">Reports</h3>
    <div className="admin-record-list">{snapshot.reports.filter((report) => ["open", "reviewing"].includes(report.status)).map((report) => <ReportRow report={report} busy={busy} act={act} key={report.id} />)}{!snapshot.reports.some((report) => ["open", "reviewing"].includes(report.status)) && <EmptyAdmin text="No unresolved reports." />}</div>
    <h3 className="admin-list-title">Recent posts</h3>
    <div className="admin-record-list">{snapshot.posts.map((post) => <article className="admin-post" key={post.id}><span><small>{post.categoryName} · {post.authorName} · {formatDate(post.createdAt)}</small><strong>{post.title}</strong><em>{post.status}</em></span><div><button disabled={Boolean(busy)} onClick={() => void act(`pin-${post.id}`, () => moderateAdminPost(post.id, { isPinned: !post.isPinned }), post.isPinned ? "Post unpinned." : "Post pinned.")}><Pin size={14} /> {post.isPinned ? "Unpin" : "Pin"}</button>{post.status === "published" ? <button disabled={Boolean(busy)} onClick={() => void act(`archive-${post.id}`, () => moderateAdminPost(post.id, { status: "archived" }), "Post archived.")}>Archive</button> : <button disabled={Boolean(busy)} onClick={() => void act(`publish-${post.id}`, () => moderateAdminPost(post.id, { status: "published" }), "Post published.")}>Publish</button>}</div></article>)}</div>
  </section>;
}

function ReportRow({ report, busy, act }: { report: AdminSnapshot["reports"][number]; busy: string; act: ActionRunner }) {
  const moderate = report.contentType === "post"
    ? () => moderateAdminPost(report.contentId, { status: "archived" })
    : report.contentType === "comment"
      ? () => removeAdminComment(report.contentId)
      : report.targetRole === "owner"
        ? null
        : () => updateAdminMember(report.contentId, { status: "suspended" });
  return <article className="admin-report"><span><small>{report.contentType} · {formatDate(report.createdAt)}</small><strong>{report.targetTitle}</strong><em>{report.targetDetail}</em><b>Report: {report.reason}</b></span><div>{moderate && <button disabled={Boolean(busy)} onClick={() => void act(`moderate-${report.id}`, moderate, report.contentType === "post" ? "Post archived." : report.contentType === "comment" ? "Comment removed." : "Member suspended.")}>Moderate</button>}<button disabled={Boolean(busy)} onClick={() => void act(`report-${report.id}`, () => updateAdminReport(report.id, "reviewing"), "Report marked for review.", false)}>Review</button><button disabled={Boolean(busy)} onClick={() => void act(`report-${report.id}`, () => updateAdminReport(report.id, "resolved"), "Report resolved.", false)}>Resolve</button><button disabled={Boolean(busy)} onClick={() => void act(`report-${report.id}`, () => updateAdminReport(report.id, "dismissed"), "Report dismissed.", false)}>Dismiss</button></div></article>;
}

function EventsAdmin({ snapshot, busy, act }: AdminSectionProps) {
  const [editing, setEditing] = useState<AdminEvent | null>(null);
  return <section className="admin-panel"><SectionHeading icon={<CalendarDays size={19} />} title="Events" detail="Create live sessions, publish them, and see attendance." /><EventForm key={editing?.id ?? "new"} event={editing} busy={busy} onCancel={() => setEditing(null)} onSave={(event) => act("event", () => saveAdminEvent(event), event.id ? "Event updated." : "Event created.")} /><div className="admin-record-list">{snapshot.events.map((event) => <article className="admin-event" key={event.id}><span><small>{event.kind.replace("_", " ")} · {event.status}</small><strong>{event.title}</strong><em>{formatDate(event.startsAt)} · {event.attendeeCount} attending</em></span><button onClick={() => setEditing(event)}><Pencil size={15} /> Edit</button></article>)}</div></section>;
}

function EventForm({ event, busy, onCancel, onSave }: { event: AdminEvent | null; busy: string; onCancel: () => void; onSave: (event: Partial<AdminEvent> & Pick<AdminEvent, "title" | "startsAt" | "endsAt">) => Promise<unknown> }) {
  const defaultStart = new Date(Date.now() + 86_400_000);
  defaultStart.setMinutes(0, 0, 0);
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [kind, setKind] = useState<AdminEvent["kind"]>(event?.kind ?? "live");
  const [hostName, setHostName] = useState(event?.hostName ?? "Steve DiFabio");
  const [startsAt, setStartsAt] = useState(localDateTime(event?.startsAt ?? defaultStart.toISOString()));
  const [endsAt, setEndsAt] = useState(localDateTime(event?.endsAt ?? new Date(defaultStart.getTime() + 3_600_000).toISOString()));
  const [meetingUrl, setMeetingUrl] = useState(event?.meetingUrl ?? "");
  const [recurrenceRule, setRecurrenceRule] = useState(event?.recurrenceRule ?? "");
  const [requiredLevel, setRequiredLevel] = useState<number | "">(event?.requiredLevel ?? "");
  const [status, setStatus] = useState<AdminStatus>(event?.status ?? "draft");
  return <details className="admin-composer" open={Boolean(event)}><summary><Plus size={16} /> {event ? `Edit ${event.title}` : "Create an event"}</summary><form onSubmit={(formEvent) => { formEvent.preventDefault(); if (!title.trim()) return; void onSave({ id: event?.id, title, description, kind, hostName, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), meetingUrl, recurrenceRule, requiredLevel: requiredLevel === "" ? null : requiredLevel, status }); }}><label>Event title<input value={title} onChange={(change) => setTitle(change.target.value)} required /></label><label>Description<textarea rows={3} value={description} onChange={(change) => setDescription(change.target.value)} /></label><div className="admin-form-grid"><label>Type<select value={kind} onChange={(change) => setKind(change.target.value as AdminEvent["kind"])}><option value="live">Live</option><option value="workshop">Workshop</option><option value="office_hours">Office hours</option></select></label><label>Host<input value={hostName} onChange={(change) => setHostName(change.target.value)} /></label></div><div className="admin-form-grid"><label>Starts<input type="datetime-local" value={startsAt} onChange={(change) => setStartsAt(change.target.value)} required /></label><label>Ends<input type="datetime-local" value={endsAt} onChange={(change) => setEndsAt(change.target.value)} required /></label></div><label>Meeting URL<input type="url" value={meetingUrl} onChange={(change) => setMeetingUrl(change.target.value)} /></label><div className="admin-form-grid"><label>Recurrence rule<input value={recurrenceRule} onChange={(change) => setRecurrenceRule(change.target.value)} placeholder="Optional schedule rule" /></label><label>Required level<input type="number" min="1" value={requiredLevel} onChange={(change) => setRequiredLevel(change.target.value ? Number(change.target.value) : "")} placeholder="All members" /></label></div><label>Status<select value={status} onChange={(change) => setStatus(change.target.value as AdminStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label><div className="admin-form-actions"><button className="primary-button" disabled={busy === "event"}>Save event</button>{event && <button type="button" className="secondary-button" onClick={onCancel}>Cancel edit</button>}</div></form></details>;
}

function MembersAdmin({ snapshot, busy, act }: AdminSectionProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminMember["role"]>("member");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  useDraftGuard(Boolean(name || email || role !== "member"));
  const members = snapshot.members.filter((member) => `${member.displayName} ${member.inviteEmail ?? ""} ${member.companyName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (filter === "all" || (filter === "review" ? memberAccessPresentation(member).needsReview : member.status === filter)));
  return <section className="admin-panel">
    <SectionHeading icon={<Users size={21} />} title="Members and access" detail="Find a member, check account setup, and manage course access." />
    <details className="admin-composer"><summary><Plus size={17} /> Add member</summary><form onSubmit={(event) => { event.preventDefault(); if (!name.trim() || !email.trim() || busy) return; void act("member", () => createAdminMember({ displayName: name, email, role }), "Member added. Set up the account when ready.").then((saved) => { if (saved) { setName(""); setEmail(""); setRole("member"); } }); }}><div className="admin-form-grid"><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as AdminMember["role"])}><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label></div><button className="primary-button" disabled={Boolean(busy)}>Add member</button></form></details>
    <AdminMemberSetup disabled={Boolean(busy)} onRun={(action, execute, message) => act(action, execute, message, false)} />
    <div className="admin-member-toolbar"><SearchField label="Search members" value={search} onChange={setSearch} placeholder="Search name, email or company…" /><label className="admin-filter-label">Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All members</option><option value="review">Needs account review</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select></label></div>
    <p className="admin-results-count" role="status">Showing {members.length} of {snapshot.members.length} members</p>
    <div className="admin-record-list">{members.map((member) => <MemberRow key={member.id} member={member} courses={snapshot.courses} busy={busy} act={act} />)}{!members.length && <EmptyAdmin text="No matching members. Try another search or filter." />}</div>
  </section>;
}

function MemberRow({ member, courses, busy, act }: { member: AdminMember; courses: AdminCourse[]; busy: string; act: ActionRunner }) {
  const [open, setOpen] = useState(false);
  const ownerProtected = member.role === "owner";
  return <article className="admin-record"><button className="admin-record-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span><small>{member.role} · {member.status} · {memberAccessPresentation(member).label}</small><strong>{member.displayName || member.inviteEmail || "Academy member"}</strong><em>{member.completedLessons} completed lessons · {member.courseIds.length} courses</em></span><ChevronDown className={open ? "rotated" : ""} size={18} /></button>{open && <div className="admin-record-body"><p className="admin-form-note">{member.inviteEmail ? `Sign-in email: ${member.inviteEmail}` : member.userId ? "This member has a connected account." : "No sign-in email is saved for this record."}</p><div className="admin-form-grid"><label>Role<select value={member.role} disabled={Boolean(busy) || ownerProtected} onChange={(event) => void act(`member-${member.id}`, () => updateAdminMember(member.id, { role: event.target.value as AdminMember["role"] }), "Member role updated.")}><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option>{ownerProtected && <option value="owner">Owner</option>}</select></label><label>Status<select value={member.status} disabled={Boolean(busy) || ownerProtected} onChange={(event) => void act(`member-${member.id}`, () => updateAdminMember(member.id, { status: event.target.value as AdminMember["status"] }), "Member status updated.")}><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select></label></div>{ownerProtected && <p className="admin-form-note">Owner access is protected. Ownership changes require the account owner.</p>}<fieldset className="admin-course-access"><legend>Course access</legend>{courses.map((course) => <label key={course.id}><input type="checkbox" checked={member.courseIds.includes(course.id)} disabled={Boolean(busy)} onChange={(event) => void act(`access-${member.id}-${course.id}`, () => setAdminMemberCourseAccess(member.id, course.id, event.target.checked), "Course access updated.")} /><span>{course.title}</span></label>)}</fieldset></div>}</article>;
}

function CertificatesAdmin({ snapshot, busy, act }: AdminSectionProps) {
  const activeTemplate = snapshot.templates.find((template) => template.active) ?? null;
  const [editing, setEditing] = useState<CertificateTemplate | null>(activeTemplate);
  const [memberId, setMemberId] = useState(snapshot.members[0]?.id ?? "");
  const [courseId, setCourseId] = useState(snapshot.courses[0]?.id ?? "");
  return <section className="admin-panel"><SectionHeading icon={<Award size={19} />} title="Certificates" detail="Define the certificate, issue it after completion, verify it, or revoke it." /><CertificateTemplateForm key={editing?.id ?? "new"} template={editing} busy={busy} onSave={(template) => act("template", () => saveCertificateTemplate(template), "Certificate template saved.")} /><div className="admin-issue-card"><h3>Issue a certificate</h3><div className="admin-form-grid"><label>Member<select value={memberId} onChange={(event) => setMemberId(event.target.value)}>{snapshot.members.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}</select></label><label>Course<select value={courseId} onChange={(event) => setCourseId(event.target.value)}>{snapshot.courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label></div><button className="primary-button" disabled={Boolean(busy) || !memberId || !courseId} onClick={() => void act("issue", () => issueAdminCertificate(memberId, courseId), "Certificate issued.")}><Award size={16} /> Issue certificate</button></div><div className="admin-record-list">{snapshot.certificates.map((certificate) => <article className="admin-certificate-row" key={certificate.id}><span><small>{formatDate(certificate.issuedAt)} · {certificate.status}</small><strong>{certificate.recipientName}</strong><em>{certificate.courseTitle} · {certificate.verificationCode.slice(0, 8)}</em></span>{certificate.status === "active" && <button disabled={Boolean(busy)} onClick={() => void act(`revoke-${certificate.id}`, () => revokeAdminCertificate(certificate.id, "Revoked by Academy administrator"), "Certificate revoked.")}>Revoke</button>}</article>)}</div>{snapshot.templates.length > 1 && <button className="text-button" onClick={() => setEditing(null)}>Create another template</button>}</section>;
}

function CertificateTemplateForm({ template, busy, onSave }: { template: CertificateTemplate | null; busy: string; onSave: (template: Partial<CertificateTemplate> & Pick<CertificateTemplate, "name">) => Promise<unknown> }) {
  const [name, setName] = useState(template?.name ?? "Dirty Turf Academy Completion");
  const [title, setTitle] = useState(template?.title ?? "Certificate of Completion");
  const [description, setDescription] = useState(template?.description ?? "has successfully completed the course");
  const [signatoryName, setSignatoryName] = useState(template?.signatoryName ?? "Steve DiFabio");
  const [signatoryTitle, setSignatoryTitle] = useState(template?.signatoryTitle ?? "Dirty Turf Academy");
  return <details className="admin-composer" open={!template}><summary><Pencil size={16} /> {template ? "Edit certificate template" : "Create certificate template"}</summary><form onSubmit={(event) => { event.preventDefault(); void onSave({ id: template?.id, name, title, description, signatoryName, signatoryTitle, active: true }); }}><label>Internal name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Certificate heading<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label>Completion statement<input value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="admin-form-grid"><label>Signed by<input value={signatoryName} onChange={(event) => setSignatoryName(event.target.value)} /></label><label>Title<input value={signatoryTitle} onChange={(event) => setSignatoryTitle(event.target.value)} /></label></div><button className="primary-button" disabled={busy === "template"}>Save certificate template</button></form></details>;
}

type ActionRunner = (label: string, action: () => Promise<unknown>, success: string, contentChanged?: boolean) => Promise<boolean>;
type AdminSectionProps = { snapshot: AdminSnapshot; busy: string; act: ActionRunner };

function SectionHeading({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="admin-section-heading"><span>{icon}</span><div><h3>{title}</h3><p>{detail}</p></div></div>; }
function Metric({ icon, value, label, detail }: { icon: React.ReactNode; value: number; label: string; detail: string }) { return <article><span>{icon}</span><strong>{value}</strong><p>{label}</p><small>{detail}</small></article>; }
function StatusRow({ complete, label }: { complete: boolean; label: string }) { return <div className={complete ? "complete" : "pending"}><span>{complete ? <Check size={15} /> : <CircleAlert size={15} />}</span><p>{label}</p><em>{complete ? "Ready" : "Action needed"}</em></div>; }
function EmptyAdmin({ text }: { text: string }) { return <div className="admin-empty">{text}</div>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Unknown date" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date); }
function localDateTime(value: string) { const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "The admin change could not be completed."; }

function StatusBadge({ status }: { status: AdminStatus }) { return <span className={`admin-status admin-status-${status}`}>{status[0].toUpperCase() + status.slice(1)}</span>; }
function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <div className="admin-search"><Search size={17} /><input type="search" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{value && <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange("")}><X size={16} /></button>}</div>; }
function nextSortOrder(rows: { sortOrder: number }[]) { return rows.length ? Math.max(...rows.map((row) => row.sortOrder)) + 1 : 0; }
