import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, BookOpen, CalendarDays, Check, ChevronDown, CircleAlert, FilePlus2, GraduationCap, LoaderCircle, Megaphone, Pencil, Pin, Plus, RefreshCw, ShieldCheck, Upload, Users } from "lucide-react";
import { emptyQuizQuestion, existingQuizBody, lessonBodyForSave, lessonBodyText, quizEditorState, quizOptionsFor, serializeQuizQuestion, updateQuizQuestion, type QuizQuestionDraft } from "../lib/adminContent";
import {
  createAdminMember,
  issueAdminCertificate,
  loadAdminSnapshot,
  moderateAdminPost,
  removeAdminComment,
  revokeAdminCertificate,
  runMemberInviteAction,
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
  type AdminCourse,
  type AdminEvent,
  type AdminLesson,
  type AdminMember,
  type AdminSnapshot,
  type AdminStatus,
  type CertificateTemplate,
} from "../lib/adminBackend";

type AdminTab = "overview" | "courses" | "community" | "events" | "members" | "certificates";

type Props = {
  onToast: (message: string) => void;
  onContentChange: () => void;
};

export function AdminStudio({ onToast, onContentChange }: Props) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSnapshot(await loadAdminSnapshot());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (label: string, action: () => Promise<unknown>, success: string, contentChanged = true) => {
    setBusy(label);
    try {
      await action();
      await refresh();
      if (contentChanged) onContentChange();
      onToast(success);
      return true;
    } catch (caught) {
      onToast(errorMessage(caught));
      return false;
    } finally {
      setBusy("");
    }
  };

  if (loading && !snapshot) return <div className="admin-loading" role="status"><LoaderCircle className="spin" size={24} /> Loading Admin Studio...</div>;
  if (error || !snapshot) return <div className="view-content admin-view"><div className="empty-state"><CircleAlert size={24} /><h3>Admin Studio could not load</h3><p>{error || "Steve's administrator access could not be verified."}</p><button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={16} /> Try again</button></div></div>;

  const openReports = snapshot.reports.filter((report) => ["open", "reviewing"].includes(report.status)).length;
  const draftCourses = snapshot.courses.filter((course) => course.status === "draft").length;
  const pendingInvites = snapshot.members.filter((member) => !member.userId || !["accepted"].includes(member.inviteStatus ?? "")).length;

  return <div className="view-content admin-view">
    <section className="admin-hero">
      <div><p><ShieldCheck size={15} /> Owner and admin only</p><h2>Admin Studio</h2><span>Manage {snapshot.communityName} without leaving the app.</span></div>
      <button className="icon-button" aria-label="Refresh Admin Studio" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} size={18} /></button>
    </section>
    <nav className="admin-tabs" aria-label="Admin sections">
      {(["overview", "courses", "community", "events", "members", "certificates"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{adminTabLabel(item)}</button>)}
    </nav>

    {tab === "overview" && <section className="admin-panel">
      <div className="admin-metrics">
        <Metric icon={<BookOpen />} value={snapshot.courses.length} label="Courses" detail={`${draftCourses} drafts`} />
        <Metric icon={<Users />} value={snapshot.members.length} label="Members" detail={`${pendingInvites} need access review`} />
        <Metric icon={<Megaphone />} value={snapshot.posts.length} label="Posts" detail={`${openReports} open reports`} />
        <Metric icon={<Award />} value={snapshot.certificates.length} label="Certificates" detail={`${snapshot.quizAttemptCount} quiz attempts`} />
      </div>
      <div className="admin-launch-checks">
        <h3>Release readiness</h3>
        <StatusRow complete={snapshot.categories.some((category) => category.name.toLowerCase() === "announcements" && !category.memberCanPost)} label="Announcements restricted to admins" />
        <StatusRow complete={snapshot.templates.some((template) => template.active)} label="Active certificate template" />
        <StatusRow complete={openReports === 0} label="No unresolved moderation reports" />
        <StatusRow complete={pendingInvites === 0} label="Every intended member has a provisioned account" />
      </div>
    </section>}

    {tab === "courses" && <CoursesAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "community" && <CommunityAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "events" && <EventsAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "members" && <MembersAdmin snapshot={snapshot} busy={busy} act={act} />}
    {tab === "certificates" && <CertificatesAdmin snapshot={snapshot} busy={busy} act={act} />}
  </div>;
}

function CoursesAdmin({ snapshot, busy, act }: AdminSectionProps) {
  const [editing, setEditing] = useState<AdminCourse | null>(null);
  const [openCourseId, setOpenCourseId] = useState(snapshot.courses[0]?.id ?? "");
  return <section className="admin-panel">
    <SectionHeading icon={<GraduationCap size={19} />} title="Courses and lessons" detail="Draft, publish, organize, and upload lesson content." />
    <CourseForm key={editing?.id ?? "new"} course={editing} busy={busy} onCancel={() => setEditing(null)} onSave={(course) => act("course", () => saveAdminCourse(course), course.id ? "Course updated." : "Course created.")} />
    <div className="admin-record-list">
      {snapshot.courses.map((course) => <article className="admin-record" key={course.id}>
        <button className="admin-record-head" onClick={() => setOpenCourseId(openCourseId === course.id ? "" : course.id)} aria-expanded={openCourseId === course.id}>
          <span><small>{course.category} · {course.status}</small><strong>{course.title}</strong><em>{course.modules.length} modules · {course.modules.reduce((total, module) => total + module.lessons.length, 0)} lessons</em></span><ChevronDown className={openCourseId === course.id ? "rotated" : ""} size={18} />
        </button>
        {openCourseId === course.id && <div className="admin-record-body">
          <div className="admin-inline-actions">
            <button onClick={() => setEditing(course)}><Pencil size={15} /> Edit course</button>
            {course.status !== "published" && <button disabled={busy === "publish-course"} onClick={() => void act("publish-course", () => saveAdminCourse({ ...course, status: "published" }), "Course published.")}><Check size={15} /> Publish</button>}
            {course.status === "published" && <button disabled={busy === "archive-course"} onClick={() => void act("archive-course", () => saveAdminCourse({ ...course, status: "archived" }), "Course archived.")}>Archive</button>}
          </div>
          <ModuleComposer courseId={course.id} nextOrder={course.modules.length} busy={busy} act={act} />
          {course.modules.map((module) => <div className="admin-module" key={module.id}>
            <div className="admin-module-heading"><span><small>{module.groupTitle || `Module ${module.sortOrder + 1}`}</small><strong>{module.title}</strong></span><em>{module.lessons.length} lessons</em></div>
            <LessonComposer courseId={course.id} moduleId={module.id} nextOrder={module.lessons.length} busy={busy} act={act} />
            <div className="admin-lesson-list">{module.lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} courseId={course.id} busy={busy} act={act} />)}</div>
          </div>)}
        </div>}
      </article>)}
      {!snapshot.courses.length && <EmptyAdmin text="Create the first course above." />}
    </div>
  </section>;
}

function CourseForm({ course, busy, onCancel, onSave }: { course: AdminCourse | null; busy: string; onCancel: () => void; onSave: (course: Partial<AdminCourse> & Pick<AdminCourse, "title">) => Promise<unknown> }) {
  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [category, setCategory] = useState(course?.category ?? "Core");
  const [instructorName, setInstructorName] = useState(course?.instructorName ?? "Steve DiFabio");
  const [accessType, setAccessType] = useState<AdminCourse["accessType"]>(course?.accessType ?? "open");
  const [requiredLevel, setRequiredLevel] = useState(course?.requiredLevel ?? 1);
  const [priceDollars, setPriceDollars] = useState((course?.priceCents ?? 0) / 100);
  const [status, setStatus] = useState<AdminStatus>(course?.status ?? "draft");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void onSave({ id: course?.id, title, description, category, instructorName, accessType, requiredLevel, priceCents: accessType === "purchase" ? Math.max(0, Math.round(priceDollars * 100)) : null, status, sortOrder: course?.sortOrder ?? 0 });
  };
  return <details className="admin-composer" open={Boolean(course)}>
    <summary><Plus size={16} /> {course ? `Edit ${course.title}` : "Create a course"}</summary>
    <form onSubmit={submit}>
      <label>Course title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required /></label>
      <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
      <div className="admin-form-grid"><label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} /></label><label>Instructor<input value={instructorName} onChange={(event) => setInstructorName(event.target.value)} /></label></div>
      <div className="admin-form-grid"><label>Access<select value={accessType} onChange={(event) => setAccessType(event.target.value as AdminCourse["accessType"])}><option value="open">Open to members</option><option value="level">Required level</option><option value="purchase">Paid assignment</option></select></label>{accessType === "level" && <label>Required level<input type="number" min="1" value={requiredLevel} onChange={(event) => setRequiredLevel(Number(event.target.value))} /></label>}{accessType === "purchase" && <label>Price (USD)<input type="number" min="0" step="0.01" value={priceDollars} onChange={(event) => setPriceDollars(Number(event.target.value))} /></label>}<label>Status<select value={status} onChange={(event) => setStatus(event.target.value as AdminStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>
      <div className="admin-form-actions"><button className="primary-button" disabled={busy === "course" || !title.trim()}>{busy === "course" ? "Saving..." : "Save course"}</button>{course && <button type="button" className="secondary-button" onClick={onCancel}>Cancel edit</button>}</div>
    </form>
  </details>;
}

function ModuleComposer({ courseId, nextOrder, busy, act }: { courseId: string; nextOrder: number; busy: string; act: ActionRunner }) {
  const [title, setTitle] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  return <details className="admin-subcomposer"><summary><Plus size={14} /> Add module</summary><form onSubmit={(event) => { event.preventDefault(); if (!title.trim()) return; void act("module", () => saveAdminModule({ courseId, title, groupTitle, sortOrder: nextOrder }), "Module added.").then((saved) => { if (saved) { setTitle(""); setGroupTitle(""); } }); }}><div className="admin-form-grid"><label>Module name<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label>Section label<input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Optional" /></label></div><button className="secondary-button" disabled={busy === "module"}><Plus size={15} /> Add module</button></form></details>;
}

function LessonComposer({ courseId, moduleId, nextOrder, busy, act, lesson }: { courseId: string; moduleId: string; nextOrder: number; busy: string; act: ActionRunner; lesson?: AdminLesson }) {
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [lessonType, setLessonType] = useState<AdminLesson["lessonType"]>(lesson?.lessonType ?? "guide");
  const initialContent = useMemo(() => lessonBodyText(lesson?.body), [lesson?.body]);
  const [content, setContent] = useState(initialContent);
  const [videoUrl, setVideoUrl] = useState(lesson?.videoUrl ?? "");
  const [durationMinutes, setDurationMinutes] = useState(Math.round((lesson?.durationSeconds ?? 0) / 60));
  const [status, setStatus] = useState<AdminStatus>(lesson?.status ?? "draft");
  const initialQuiz = useMemo(() => quizEditorState(lesson?.body), [lesson?.body]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionDraft[]>(initialQuiz.questions);
  const [passingPercent, setPassingPercent] = useState(initialQuiz.passingPercent);
  const quizIsValid = quizQuestions.length > 0 && quizQuestions.every((question) => question.prompt.trim() && quizOptionsFor(question).length >= 2 && question.correctOption >= 1 && question.correctOption <= quizOptionsFor(question).length);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (lessonType === "quiz" && !quizIsValid)) return;
    const body = lessonBodyForSave(lesson?.body, initialContent, content);
    if (lessonType === "quiz") body.quiz = { ...existingQuizBody(lesson?.body), name: title.trim(), requiresPassing: true, passingPercent, questions: quizQuestions.map(serializeQuizQuestion) };
    const saved = await act("lesson", () => saveAdminLesson({ id: lesson?.id, moduleId, title, lessonType, body, videoUrl, transcript: lesson?.transcript ?? "", resources: lesson?.resources ?? [], durationSeconds: Math.max(0, durationMinutes * 60), sortOrder: lesson?.sortOrder ?? nextOrder, status }), lesson ? "Lesson updated." : "Lesson added.");
    if (saved && !lesson) { setTitle(""); setContent(""); setVideoUrl(""); setQuizQuestions([emptyQuizQuestion()]); }
  };
  return <details className="admin-subcomposer" open={Boolean(lesson)}><summary><FilePlus2 size={14} /> {lesson ? "Edit lesson" : "Add lesson"}</summary><form onSubmit={(event) => void submit(event)}>
    <div className="admin-form-grid"><label>Lesson title<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label>Type<select value={lessonType} onChange={(event) => setLessonType(event.target.value as AdminLesson["lessonType"])}><option value="guide">Guide</option><option value="video">Video</option><option value="quiz">Quiz</option></select></label></div>
    <label>Lesson content<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} placeholder="Write what members should learn..." /></label>
    {lessonType === "video" && <label>Video URL<input type="url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://..." /></label>}
    {lessonType === "quiz" && <div className="admin-quiz-builder">
      {quizQuestions.map((question, index) => <div className="admin-quiz-question" key={question.id}>
        <div className="admin-quiz-question-heading"><strong>Question {index + 1}</strong>{quizQuestions.length > 1 && <button type="button" onClick={() => setQuizQuestions((current) => current.filter((item) => item.id !== question.id))}>Remove</button>}</div>
        <label>Question<input value={question.prompt} onChange={(event) => setQuizQuestions((current) => updateQuizQuestion(current, question.id, { prompt: event.target.value }))} required /></label>
        <label>Answer choices<textarea rows={4} value={question.optionLines} onChange={(event) => setQuizQuestions((current) => updateQuizQuestion(current, question.id, { optionLines: event.target.value }))} placeholder={'One choice per line'} required /></label>
        <div className="admin-form-grid"><label>Correct choice number<input type="number" min="1" max={Math.max(1, quizOptionsFor(question).length)} value={question.correctOption} onChange={(event) => setQuizQuestions((current) => updateQuizQuestion(current, question.id, { correctOption: Number(event.target.value) }))} required /></label><label>Answer explanation<input value={question.explanation} onChange={(event) => setQuizQuestions((current) => updateQuizQuestion(current, question.id, { explanation: event.target.value }))} placeholder="Shown after submitting" /></label></div>
      </div>)}
      <button type="button" className="secondary-button" onClick={() => setQuizQuestions((current) => [...current, emptyQuizQuestion()])}><Plus size={15} /> Add question</button>
      <label>Passing score<input type="number" min="1" max="100" value={passingPercent} onChange={(event) => setPassingPercent(Number(event.target.value))} /></label>
      {!quizIsValid && <p className="admin-form-error">Every quiz needs a question, at least two choices, and a valid correct-choice number.</p>}
    </div>}
    <div className="admin-form-grid"><label>Minutes<input type="number" min="0" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as AdminStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>
    <button className="secondary-button" disabled={busy === "lesson" || !title.trim() || (lessonType === "quiz" && !quizIsValid)}><Check size={15} /> Save lesson</button>
  </form></details>;
}

function LessonRow({ lesson, courseId, busy, act }: { lesson: AdminLesson; courseId: string; busy: string; act: ActionRunner }) {
  const [editing, setEditing] = useState(false);
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const uploaded = await act(`asset-${lesson.id}`, () => uploadAdminLessonAsset(file, courseId, lesson.id), "Lesson file uploaded.");
    if (uploaded) event.target.value = "";
  };
  return <div className="admin-lesson">
    <span><strong>{lesson.title}</strong><small>{lesson.lessonType} · {lesson.status} · {Math.round(lesson.durationSeconds / 60)} min</small></span>
    <div><button aria-label={`Edit ${lesson.title}`} onClick={() => setEditing((value) => !value)}><Pencil size={15} /></button><label className="admin-upload-button"><Upload size={15} /><span>Upload</span><input type="file" accept="video/*,audio/*,image/*,.pdf,.doc,.docx" disabled={busy === `asset-${lesson.id}`} onChange={(event) => void upload(event)} /></label></div>
    {editing && <LessonComposer lesson={lesson} courseId={courseId} moduleId={lesson.moduleId} nextOrder={lesson.sortOrder} busy={busy} act={act} />}
  </div>;
}

function CommunityAdmin({ snapshot, busy, act }: AdminSectionProps) {
  const [categoryName, setCategoryName] = useState("");
  return <section className="admin-panel">
    <SectionHeading icon={<Megaphone size={19} />} title="Community and moderation" detail="Control channels, announcements, pinned posts, and member reports." />
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
  return <section className="admin-panel"><SectionHeading icon={<Users size={19} />} title="Members and access" detail="Invite people, assign roles and courses, suspend access, and review progress." /><details className="admin-composer"><summary><Plus size={16} /> Add member</summary><form onSubmit={(event) => { event.preventDefault(); if (!name.trim() || !email.trim()) return; void act("member", () => createAdminMember({ displayName: name, email, role }), "Member added. Provision the account when ready.").then((saved) => { if (saved) { setName(""); setEmail(""); } }); }}><div className="admin-form-grid"><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as AdminMember["role"])}><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label></div><button className="primary-button" disabled={busy === "member"}>Add member</button></form></details><div className="admin-member-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("provision", () => runMemberInviteAction("provision"), "Pending accounts provisioned.", false)}>Provision accounts</button><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void act("notify", () => runMemberInviteAction("notify"), "Sign-in invitations sent.", false)}>Send sign-in emails</button></div><div className="admin-record-list">{snapshot.members.map((member) => <MemberRow key={member.id} member={member} courses={snapshot.courses} busy={busy} act={act} />)}</div></section>;
}

function MemberRow({ member, courses, busy, act }: { member: AdminMember; courses: AdminCourse[]; busy: string; act: ActionRunner }) {
  const [open, setOpen] = useState(false);
  const ownerProtected = member.role === "owner";
  return <article className="admin-record"><button className="admin-record-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span><small>{member.role} · {member.status} · {member.inviteStatus ?? "no invite"}</small><strong>{member.displayName || member.inviteEmail || "Academy member"}</strong><em>{member.completedLessons} completed lessons · {member.courseIds.length} courses</em></span><ChevronDown className={open ? "rotated" : ""} size={18} /></button>{open && <div className="admin-record-body"><div className="admin-form-grid"><label>Role<select value={member.role} disabled={Boolean(busy) || ownerProtected} onChange={(event) => void act(`member-${member.id}`, () => updateAdminMember(member.id, { role: event.target.value as AdminMember["role"] }), "Member role updated.")}><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option>{ownerProtected && <option value="owner">Owner</option>}</select></label><label>Status<select value={member.status} disabled={Boolean(busy) || ownerProtected} onChange={(event) => void act(`member-${member.id}`, () => updateAdminMember(member.id, { status: event.target.value as AdminMember["status"] }), "Member status updated.")}><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select></label></div>{ownerProtected && <p className="admin-form-note">Owner access is protected. Ownership changes require the account owner.</p>}<fieldset className="admin-course-access"><legend>Course access</legend>{courses.map((course) => <label key={course.id}><input type="checkbox" checked={member.courseIds.includes(course.id)} disabled={Boolean(busy)} onChange={(event) => void act(`access-${member.id}-${course.id}`, () => setAdminMemberCourseAccess(member.id, course.id, event.target.checked), "Course access updated.")} /><span>{course.title}</span></label>)}</fieldset></div>}</article>;
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
function adminTabLabel(tab: AdminTab) { return tab === "members" ? "People" : tab[0].toUpperCase() + tab.slice(1); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Unknown date" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date); }
function localDateTime(value: string) { const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "The admin change could not be completed."; }
