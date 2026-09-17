import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, CheckCircle2, ChevronDown, ExternalLink, FileText, Lock, MessageSquare, Play, Trophy } from "lucide-react";
import type { Course } from "../domain";

type Props = {
  courses: Course[];
  externalUrl: string;
  onCoursesChange: (courses: Course[]) => void;
  onToast: (message: string) => void;
  onDiscuss: () => void;
};

export function AcademyView({ courses, externalUrl, onCoursesChange, onToast, onDiscuss }: Props) {
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  const selected = courses.find((course) => course.id === selectedId);
  const visibleCourses = filter === "All" ? courses : courses.filter((course) => course.category === filter);
  const counts = useMemo(() => {
    const lessons = courses.flatMap((course) => course.modules.flatMap((module) => module.lessons));
    return { done: lessons.filter((lesson) => lesson.completed).length, total: lessons.length };
  }, [courses]);
  const overall = Math.round((counts.done / Math.max(1, counts.total)) * 100);
  const openCourse = (id: string) => {
    setSelectedId(id);
    document.querySelector(".phone-frame")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  const completeLesson = (lessonId: string) => {
    const next = courses.map((course) => {
      const modules = course.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => lesson.id === lessonId ? { ...lesson, completed: !lesson.completed } : lesson),
      }));
      const allLessons = modules.flatMap((module) => module.lessons);
      return { ...course, modules, progress: Math.round(allLessons.filter((lesson) => lesson.completed).length / allLessons.length * 100) };
    });
    onCoursesChange(next);
    onToast("Lesson progress saved.");
  };

  if (selected) {
    const lessonCount = selected.modules.reduce((total, module) => total + module.lessons.length, 0);
    return (
      <div className="view-content lesson-view">
        <button className="back-link" onClick={() => setSelectedId(null)}><ArrowLeft size={17} /> Academy</button>
        <section className="course-hero">
          <div className="course-hero-mark"><BookOpen size={25} /></div>
          <span>{selected.category} · {selected.instructor}</span>
          <h2>{selected.title}</h2>
          <p>{selected.description}</p>
          <div className="course-hero-foot"><span>{lessonCount} lessons</span><span>{selected.duration}</span><strong>{selected.progress}% complete</strong></div>
          <div className="progress-track light"><span style={{ width: `${selected.progress}%` }} /></div>
        </section>
        <section className="module-list">
          {selected.modules.map((module, moduleIndex) => {
            const moduleKey = `${selected.id}-${moduleIndex}`;
            const expanded = openModules[moduleKey] ?? moduleIndex === 0;
            return <article className="module" key={module.title}>
              <button className="module-header" onClick={() => setOpenModules((current) => ({ ...current, [moduleKey]: !expanded }))} aria-expanded={expanded}>
                <span><small>Module {moduleIndex + 1}</small><strong>{module.title}</strong></span>
                <span>{module.lessons.filter((lesson) => lesson.completed).length}/{module.lessons.length}<ChevronDown className={expanded ? "rotated" : ""} size={17} /></span>
              </button>
              {expanded && <div className="lesson-list">{module.lessons.map((lesson) => <button className={lesson.completed ? "lesson-row complete" : "lesson-row"} key={lesson.id} onClick={() => lesson.locked ? onToast("Reach the required level to unlock this lesson.") : completeLesson(lesson.id)}>
                <span className="lesson-status">{lesson.locked ? <Lock size={15} /> : lesson.completed ? <Check size={15} /> : lesson.type === "video" ? <Play size={14} /> : <FileText size={15} />}</span>
                <span><strong>{lesson.title}</strong><small>{lesson.type} · {lesson.duration}</small></span>
                {lesson.completed && <CheckCircle2 size={17} />}
              </button>)}</div>}
            </article>;
          })}
        </section>
        <div className="course-actions"><button className="secondary-button" onClick={onDiscuss}><MessageSquare size={17} /> Discuss this course</button><a className="secondary-button" href={externalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} /> Live resources</a></div>
      </div>
    );
  }

  return (
    <div className="view-content academy-view">
      <section className="academy-banner">
        <div className="academy-mark"><Trophy size={24} /></div>
        <div><p>Operator certification</p><h2>Turf Cleaning Operator</h2><span>{counts.done} of {counts.total} lessons complete</span></div>
        <div className="ring-progress" style={{ background: `conic-gradient(var(--lime) ${overall}%, rgba(255,255,255,.14) 0)` }} aria-label={`${overall} percent complete`}><span>{overall}%</span></div>
      </section>
      <a className="portal-link" href={externalUrl} target="_blank" rel="noopener noreferrer">
        <span className="portal-link-icon"><BookOpen size={18} /></span>
        <span><strong>Open live course library</strong><small>Dirty Turf Academy on academy.dirtyturf.com</small></span>
        <ExternalLink size={17} />
      </a>
      <div className="filter-tabs" role="tablist" aria-label="Course filters">{["All", "Core", "Advanced", "Operations", "Sales"].map((tag) => <button role="tab" aria-selected={filter === tag} className={filter === tag ? "active" : ""} onClick={() => setFilter(tag)} key={tag}>{tag}</button>)}</div>
      <section className="course-list">
        <div className="section-heading"><div><p>Training library</p><h3>Your courses</h3></div><span className="sync-status"><Check size={13} /> Live library</span></div>
        {visibleCourses.map((course) => {
          const count = course.modules.reduce((total, module) => total + module.lessons.length, 0);
          const locked = course.access === "level" && (course.requiredLevel ?? 0) > 4;
          return <button className="course-card course-button" key={course.id} onClick={() => locked ? onToast(`Reach level ${course.requiredLevel} to unlock this course.`) : openCourse(course.id)}>
            <span className={locked ? "play-button locked" : "play-button"}>{locked ? <Lock size={15} /> : <Play size={15} fill="currentColor" />}</span>
            <span><span className="course-meta"><span>{course.category}</span><span>{count} lessons · {course.duration}</span></span><strong className="course-title">{course.title}</strong><span className="course-description">{course.description}</span><span className="course-foot"><span className="progress-track"><span style={{ width: `${course.progress}%` }} /></span><span>{course.progress}%</span></span></span>
          </button>;
        })}
      </section>
    </div>
  );
}
