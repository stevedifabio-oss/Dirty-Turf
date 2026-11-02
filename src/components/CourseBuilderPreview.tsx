import { useEffect, useMemo, useRef, useState } from "react";
import { courses as sampleCourses } from "../appData";
import type { AdminCourse, AdminLesson, AdminSnapshot } from "../lib/adminBackend";
import { CoursesAdmin, DraftContext, type ActionRunner } from "./AdminStudio";
import { CourseAuthoringContext, courseAuthoring } from "./CourseAuthoringContext";

const storageKey = "dirty-turf-course-editor-preview-v1";
function samples(): AdminCourse[] {
  return sampleCourses.slice(0, 2).map((course, index) => ({ id: `preview-course-${index}`, title: course.title, description: course.description, category: course.category, instructorName: course.instructor, accessType: "open", requiredLevel: null, priceCents: null, sortOrder: index, status: "published", modules: course.modules.map((module, mi) => ({ id: `preview-module-${index}-${mi}`, courseId: `preview-course-${index}`, title: module.title, groupTitle: "", sortOrder: mi, dripAfterDays: null, lessons: module.lessons.map((lesson, li) => ({ id: lesson.id, moduleId: `preview-module-${index}-${mi}`, title: lesson.title, lessonType: "guide", body: { html: `<h2>${lesson.title}</h2><p>This is sample lesson content for trying your editor. <strong>Write your own instructions</strong>, add a photo or video link, and drag the content boxes into place.</p>` }, videoUrl: "", transcript: "", resources: [], durationSeconds: 300, sortOrder: li, status: "published" } satisfies AdminLesson)) })) }));
}

/** Deliberately separate from member preview, auth, and all hosted data. */
export function CourseBuilderPreview() {
  const [courses, setCourses] = useState<AdminCourse[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || "null"); if (Array.isArray(value) && value.length && value.every(course => Array.isArray(course.modules))) return value; } catch { /* Start a fresh sandbox. */ }
    return samples();
  });
  const current = useRef(courses); current.current = courses;
  const drafts = useRef(new Set<string>());
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (drafts.current.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  const pending = useRef(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const store = (next: AdminCourse[]) => { localStorage.setItem(storageKey, JSON.stringify(next)); current.current = next; setCourses(next); };
  const api = useMemo<typeof courseAuthoring>(() => ({
    async saveAdminCourse(input) {
      const id = input.id || crypto.randomUUID();
      const existing = current.current.find(course => course.id === id);
      store(existing ? current.current.map(course => course.id === id ? { ...course, ...input } : course) : [...current.current, { description: "", category: "Core", instructorName: "Steve", accessType: "open", requiredLevel: null, priceCents: null, sortOrder: current.current.length, status: "draft", modules: [], ...input, id }]);
      return id;
    },
    async saveAdminModule(input) {
      const id = input.id || crypto.randomUUID();
      store(current.current.map(course => course.id !== input.courseId ? course : { ...course, modules: input.id ? course.modules.map(module => module.id === id ? { ...module, ...input } : module) : [...course.modules, { groupTitle: "", sortOrder: course.modules.length, dripAfterDays: null, lessons: [], ...input, id }] }));
      return id;
    },
    async saveAdminLesson(input) {
      const id = input.id || crypto.randomUUID();
      store(current.current.map(course => ({ ...course, modules: course.modules.map(module => module.id !== input.moduleId ? module : { ...module, lessons: input.id ? module.lessons.map(lesson => lesson.id === id ? { ...lesson, ...input } : lesson) : [...module.lessons, { lessonType: "guide", body: {}, videoUrl: "", transcript: "", resources: [], durationSeconds: 0, sortOrder: module.lessons.length, status: "draft", ...input, id }] }) })));
      return id;
    },
    async saveAdminCourseOrder(courseId, _original, next) {
      store(current.current.map(course => {
        if (course.id !== courseId) return course;
        const lessons = new Map(course.modules.flatMap(module => module.lessons.map(lesson => [lesson.id, lesson] as const)));
        return { ...course, modules: next.map(order => ({ ...course.modules.find(module => module.id === order.id)!, sortOrder: order.sortOrder, lessons: order.lessons.map(item => ({ ...lessons.get(item.id)!, moduleId: order.id, sortOrder: item.sortOrder })) })) };
      }));
    },
    async loadAdminLessonBlockMedia() { return {}; },
    async uploadAdminLessonAsset() { throw new Error("Uploads need the connected backend. You can try text, formatting and media links in this local preview."); },
    async uploadAdminLessonBlockAsset() { throw new Error("Uploads need the connected backend. Paste a photo or video link to try media in this local preview."); },
  }), []);
  const act: ActionRunner = async (label, action, success) => {
    if (pending.current) return false;
    pending.current = true; setBusy(label); setError("");
    try { await action(); setMessage(`${success} Saved only in this browser.`); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The preview could not save. Try again."); return false; }
    finally { pending.current = false; setBusy(""); }
  };
  const snapshot: AdminSnapshot = { courses, communityId: "preview", organizationId: "preview", communityName: "Local course editor preview", members: [], events: [], categories: [], posts: [], reports: [], templates: [], certificates: [], quizAttemptCount: 0 };
  return <DraftContext.Provider value={drafts}><CourseAuthoringContext.Provider value={api}><main className="course-builder-preview admin-view">
    <header className="admin-hero"><div><p>Dirty Turf Academy · Editor preview</p><h2>Build your training.</h2><span>Sample courses · saved in this browser · no live member changes</span></div><a className="secondary-button" href="/">Back to app preview</a></header>
    <p className="admin-form-note">Try editing a lesson, formatting its description, or arranging modules and lessons. File uploads need the connected backend. These sample changes do not update GHL or the live Academy.</p>
    {error && <p role="alert" className="admin-feedback">{error}</p>}
    {message && <p role="status" className="preview-save-status">{message}</p>}
    <fieldset className="admin-workspace-fields" disabled={Boolean(busy)}><CoursesAdmin snapshot={snapshot} busy={busy} act={act} /></fieldset>
  </main></CourseAuthoringContext.Provider></DraftContext.Provider>;
}
