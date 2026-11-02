import { useId, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Check, X } from "lucide-react";
import type { AdminCourse } from "../lib/adminBackend";
import { hasCourseOrderChanges, moveCourseLesson, moveCourseModule, snapshotCourseOrder, type CourseOrderModule } from "../lib/courseOrder";
import { ReorderHandle } from "./ReorderHandle";

export function CourseOutlineEditor({ course, busy, onSave, onClose, onDirtyChange }: {
  course: AdminCourse;
  busy: boolean;
  onSave: (original: CourseOrderModule[], next: CourseOrderModule[]) => Promise<boolean>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const listId = useId();
  const [original] = useState(() => snapshotCourseOrder(course.modules));
  const [order, setOrder] = useState(original);
  const [message, setMessage] = useState("");
  const close = () => { if (!busy && (!hasCourseOrderChanges(original, order) || window.confirm("Discard your unsaved course order?"))) { onDirtyChange(false); onClose(); } };
  const modules = new Map(course.modules.map(module => [module.id, module]));
  const lessons = new Map(course.modules.flatMap(module => module.lessons.map(lesson => [lesson.id, lesson] as const)));
  const change = (next: CourseOrderModule[], announcement: string) => {
    if (busy) return;
    setOrder(next); onDirtyChange(hasCourseOrderChanges(original, next)); setMessage(announcement);
  };
  const blocked = (id: string) => modules.get(id)?.memberVisibility === "source-hidden" || modules.get(id)?.memberVisibility === "source-archived";
  const moveModule = (id: string, target: number) => {
    if (target < 0 || target >= order.length || blocked(id) || blocked(order[target].id)) return;
    const sourceIndex = order.findIndex(item => item.id === id);
    if (order.slice(Math.min(sourceIndex, target), Math.max(sourceIndex, target) + 1).some(item => blocked(item.id))) {
      setMessage("Hidden source modules stay in place. Move boxes within the visible section."); return;
    }
    change(moveCourseModule(order, id, target), `${modules.get(id)?.title} moved to position ${target + 1}. Save order to apply.`);
  };
  const moveLesson = (id: string, moduleId: string, target: number) => {
    const source = order.find(module => module.lessons.some(lesson => lesson.id === id));
    const destination = order.find(module => module.id === moduleId);
    if (!source || !destination || blocked(source.id) || blocked(moduleId) || target < 0 || target > destination.lessons.length - (source.id === moduleId ? 1 : 0)) return;
    change(moveCourseLesson(order, id, moduleId, target), `${lessons.get(id)?.title} moved. Save order to apply.`);
  };
  return <section className="course-outline-editor" aria-label="Arrange course outline">
    <header><div><h4>Arrange your course</h4><p>Drag the grips to move boxes. Use arrows on a phone, or choose another module for a lesson. Nothing changes for members until you save.</p></div><button type="button" className="icon-button" aria-label="Close arrange course" disabled={busy} onClick={close}><X size={18} /></button></header>
    <div data-reorder-list={listId} className="course-outline-modules">{order.map((moduleOrder, moduleIndex) => {
      const module = modules.get(moduleOrder.id)!;
      const hidden = blocked(module.id);
      return <section key={module.id} data-reorder-item={module.id} className="course-outline-module">
        <header><ReorderHandle name={`module ${module.title}`} disabled={busy || hidden} onStep={direction => moveModule(module.id, moduleIndex + direction)} onMove={(id, before) => {
          const target = order.findIndex(item => item.id === id);
          moveModule(module.id, target + (before ? 0 : 1) - (moduleIndex < target || (moduleIndex === target && !before) ? 1 : 0));
        }} /><BookOpen size={17} /><strong>{module.title}</strong><span className="outline-step-controls"><button type="button" aria-label={`Move module ${module.title} up`} disabled={busy || hidden || moduleIndex === 0 || blocked(order[moduleIndex - 1].id)} onClick={() => moveModule(module.id, moduleIndex - 1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move module ${module.title} down`} disabled={busy || hidden || moduleIndex === order.length - 1 || blocked(order[moduleIndex + 1].id)} onClick={() => moveModule(module.id, moduleIndex + 1)}><ArrowDown size={16} /></button></span></header>
        {hidden && <p className="admin-form-note">This source module is hidden or archived. Its availability and contents are kept.</p>}
        <div data-reorder-list={`${listId}-${module.id}`} className="course-outline-lessons">{moduleOrder.lessons.map((lessonOrder, lessonIndex) => {
          const lesson = lessons.get(lessonOrder.id)!;
          return <div key={lesson.id} data-reorder-item={lesson.id} className="course-outline-lesson"><ReorderHandle name={`lesson ${lesson.title}`} disabled={busy || hidden} onStep={direction => moveLesson(lesson.id, module.id, lessonIndex + direction)} onMove={(id, before) => {
            const target = moduleOrder.lessons.findIndex(item => item.id === id);
            moveLesson(lesson.id, module.id, target + (before ? 0 : 1) - (lessonIndex < target || (lessonIndex === target && !before) ? 1 : 0));
          }} /><span><strong>{lesson.title}</strong><small>{lesson.status} · {lesson.lessonType}</small></span><span className="outline-step-controls"><button type="button" aria-label={`Move lesson ${lesson.title} up`} disabled={busy || hidden || lessonIndex === 0} onClick={() => moveLesson(lesson.id, module.id, lessonIndex - 1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move lesson ${lesson.title} down`} disabled={busy || hidden || lessonIndex === moduleOrder.lessons.length - 1} onClick={() => moveLesson(lesson.id, module.id, lessonIndex + 1)}><ArrowDown size={16} /></button></span><label>Module<select aria-label={`Module for ${lesson.title}`} value={module.id} disabled={busy || hidden} onChange={event => moveLesson(lesson.id, event.target.value, order.find(item => item.id === event.target.value)?.lessons.length ?? 0)}>{order.map(item => <option key={item.id} value={item.id} disabled={blocked(item.id)}>{modules.get(item.id)?.title}</option>)}</select></label></div>;
        })}{!moduleOrder.lessons.length && <p className="admin-muted">No lessons. Move one here using its Module menu.</p>}</div>
      </section>;
    })}</div>
    <p className="admin-form-note" role="status" aria-live="polite">{message || "Lesson progress stays with each lesson when you move it."}</p>
    <footer className="admin-form-actions"><button type="button" className="primary-button" disabled={busy || !hasCourseOrderChanges(original, order)} onClick={() => void onSave(original, order).then(saved => { if (saved) { onDirtyChange(false); onClose(); } })}><Check size={16} />{busy ? "Saving…" : "Save order"}</button><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button></footer>
  </section>;
}
