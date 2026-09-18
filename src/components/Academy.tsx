import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, CheckCircle2, ChevronDown, Circle, Download, ExternalLink, FileText, Lock, MessageSquare, Play, RotateCcw, Trophy, XCircle } from "lucide-react";
import type { Course, LessonQuiz } from "../domain";
import { combinedCourseProgress } from "../lib/courseProgress";
import { safeExternalUrl } from "../lib/safeExternalUrl";
import { SafeRichText } from "./SafeRichText";

type Props = {
  courses: Course[];
  dataMode: "device" | "cloud";
  onCoursesChange: (courses: Course[]) => void;
  onLessonCompletion: (lessonId: string, completed: boolean) => Promise<void>;
  onToast: (message: string) => void;
  onDiscuss: () => void;
};

export function AcademyView({ courses, dataMode, onCoursesChange, onLessonCompletion, onToast, onDiscuss }: Props) {
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  const selected = courses.find((course) => course.id === selectedId);
  const visibleCourses = filter === "All" ? courses : courses.filter((course) => course.category === filter);
  const overall = useMemo(() => {
    const weighted = courses.reduce((total, course) => {
      const lessonCount = course.modules.reduce((count, module) => count + module.lessons.length, 0);
      return total + course.progress * Math.max(1, lessonCount);
    }, 0);
    const weight = courses.reduce((total, course) => total + Math.max(1, course.modules.reduce((count, module) => count + module.lessons.length, 0)), 0);
    return Math.round(weighted / Math.max(1, weight));
  }, [courses]);
  const openCourse = (id: string) => {
    setSelectedId(id);
    document.querySelector(".phone-frame")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  const completeLesson = async (lessonId: string) => {
    const currentLesson = courses.flatMap((course) => course.modules.flatMap((module) => module.lessons)).find((lesson) => lesson.id === lessonId);
    const completed = !currentLesson?.completed;
    const next = courses.map((course) => {
      const modules = course.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => lesson.id === lessonId ? { ...lesson, completed } : lesson),
      }));
      const allLessons = modules.flatMap((module) => module.lessons);
      return {
        ...course,
        modules,
        progress: combinedCourseProgress(allLessons.filter((lesson) => lesson.completed).length, allLessons.length, course.importedProgress),
      };
    });
    onCoursesChange(next);
    try {
      await onLessonCompletion(currentLesson?.cloudId ?? lessonId, completed);
      onToast(completed ? "Lesson marked complete." : "Lesson moved back to in progress.");
    } catch {
      onCoursesChange(courses);
      onToast("Lesson progress could not be saved.");
    }
  };

  const selectedLesson = selected?.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === selectedLessonId);

  if (dataMode === "device") {
    return <div className="view-content academy-view"><div className="empty-state"><Lock size={24} /><h3>Sign in to view Academy lessons</h3><p>The training library only displays published content from the connected Academy. Demo lessons are disabled.</p></div></div>;
  }

  if (selected && selectedLesson) {
    const videoUrl = safeExternalUrl(selectedLesson.videoUrl);
    const resources = (selectedLesson.resources ?? []).flatMap((resource) => {
      const url = safeExternalUrl(resource.url);
      return url ? [{ ...resource, url }] : [];
    });
    const directVideo = /\.(mp4|webm|mov)(\?|$)/i.test(videoUrl ?? "");
    const hasContent = Boolean(selectedLesson.body?.trim() || selectedLesson.bodyHtml?.trim() || videoUrl || resources.length || selectedLesson.transcript?.trim() || selectedLesson.quiz?.questions.length);
    return (
      <div className="view-content lesson-view">
        <button className="back-link" onClick={() => setSelectedLessonId(null)}><ArrowLeft size={17} /> {selected.title}</button>
        <article className="lesson-content">
          <span className="lesson-type"><BookOpen size={16} /> {selectedLesson.type} · {selectedLesson.duration}</span>
          <h2>{selectedLesson.title}</h2>
          {videoUrl && directVideo && <video className="lesson-video" controls preload="metadata" src={videoUrl} />}
          {videoUrl && !directVideo && <a className="lesson-video-link" href={videoUrl} target="_blank" rel="noopener noreferrer"><Play size={18} /> Open lesson video <ExternalLink size={15} /></a>}
          {selectedLesson.type === "quiz" && selectedLesson.quiz && <QuizLesson key={selectedLesson.id} quiz={selectedLesson.quiz} />}
          <SafeRichText html={selectedLesson.bodyHtml} fallback={selectedLesson.body} />
          {selectedLesson.transcript && <details className="lesson-transcript"><summary>Transcript</summary><p>{selectedLesson.transcript}</p></details>}
          {!!resources.length && <section className="lesson-resources"><h3>Resources</h3>{resources.map((resource) => <a href={resource.url} target="_blank" rel="noopener noreferrer" key={`${resource.title}-${resource.url}`}><Download size={17} /><span><strong>{resource.title}</strong><small>{resource.type ?? "Download"}</small></span><ExternalLink size={15} /></a>)}</section>}
          {!hasContent && <div className="empty-state"><XCircle size={24} /><h3>Lesson content unavailable</h3><p>This published lesson does not currently contain readable lesson text or media.</p></div>}
        </article>
        {hasContent && <button className={selectedLesson.completed ? "secondary-button wide" : "primary-button wide"} onClick={() => void completeLesson(selectedLesson.id)}>{selectedLesson.completed ? <Check size={18} /> : <CheckCircle2 size={18} />}{selectedLesson.completed ? "Completed" : "Mark lesson complete"}</button>}
      </div>
    );
  }

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
                <span><small>{module.groupTitle ?? `Module ${moduleIndex + 1}`}</small><strong>{module.title}</strong></span>
                <span>{module.lessons.filter((lesson) => lesson.completed).length}/{module.lessons.length}<ChevronDown className={expanded ? "rotated" : ""} size={17} /></span>
              </button>
              {expanded && <div className="lesson-list">{module.lessons.map((lesson) => <button className={lesson.completed ? "lesson-row complete" : "lesson-row"} key={lesson.id} onClick={() => lesson.locked ? onToast("Reach the required level to unlock this lesson.") : setSelectedLessonId(lesson.id)}>
                <span className="lesson-status">{lesson.locked ? <Lock size={15} /> : lesson.completed ? <Check size={15} /> : lesson.type === "video" ? <Play size={14} /> : <FileText size={15} />}</span>
                <span><strong>{lesson.title}</strong><small>{lesson.type} · {lesson.duration}</small></span>
                {lesson.completed && <CheckCircle2 size={17} />}
              </button>)}</div>}
            </article>;
          })}
        </section>
        <div className="course-actions"><button className="secondary-button" onClick={onDiscuss}><MessageSquare size={17} /> Discuss this course</button></div>
      </div>
    );
  }

  if (!courses.length) {
    return <div className="view-content academy-view"><div className="empty-state"><BookOpen size={24} /><h3>No published courses available</h3><p>The Academy library is connected, but no published course content is available for this account.</p></div></div>;
  }

  return (
    <div className="view-content academy-view">
      <section className="academy-banner">
        <div className="academy-mark"><Trophy size={24} /></div>
        <div><p>Operator certification</p><h2>Turf Cleaning Operator</h2><span>{overall}% overall progress</span></div>
        <div className="ring-progress" style={{ background: `conic-gradient(var(--lime) ${overall}%, rgba(255,255,255,.14) 0)` }} aria-label={`${overall} percent complete`}><span>{overall}%</span></div>
      </section>
      <div className="filter-tabs" role="tablist" aria-label="Course filters">{["All", "Core", "Advanced", "Operations", "Sales"].map((tag) => <button role="tab" aria-selected={filter === tag} className={filter === tag ? "active" : ""} onClick={() => setFilter(tag)} key={tag}>{tag}</button>)}</div>
      <section className="course-list">
        <div className="section-heading"><div><p>Training library</p><h3>Your courses</h3></div><span className="sync-status"><Check size={13} /> In app</span></div>
        {visibleCourses.map((course) => {
          const count = course.modules.reduce((total, module) => total + module.lessons.length, 0);
          const locked = course.access === "level" && (course.requiredLevel ?? 0) > 4;
          return <button className="course-card course-button" key={course.id} onClick={() => locked ? onToast(`Reach level ${course.requiredLevel} to unlock this course.`) : openCourse(course.id)}>
            <span className={locked ? "play-button locked" : "play-button"}>{locked ? <Lock size={15} /> : <Play size={15} fill="currentColor" />}</span>
            <span><span className="course-meta"><span>{course.category}</span><span>{count} lessons · {course.duration}</span></span><strong className="course-title">{course.title}</strong><span className="course-description">{course.description}</span><span className="course-foot"><span className="progress-track"><span style={{ width: `${course.progress}%` }} /></span><span>{course.progress}%</span></span></span>
          </button>;
        })}
        {visibleCourses.length === 0 && <div className="empty-state"><BookOpen size={24} /><h3>No courses assigned yet</h3><p>Your Academy access is active. Assigned courses will appear here.</p></div>}
      </section>
    </div>
  );
}

function QuizLesson({ quiz }: { quiz: LessonQuiz }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const answerKeyCount = quiz.questions.filter((question) => question.correctOptionIndex !== undefined).length;
  const correctCount = quiz.questions.filter((question, index) => question.correctOptionIndex !== undefined && answers[index] === question.correctOptionIndex).length;
  const allAnswered = quiz.questions.every((_, index) => answers[index] !== undefined);
  const score = answerKeyCount ? Math.round(correctCount / answerKeyCount * 100) : null;

  const chooseAnswer = (questionIndex: number, optionIndex: number) => {
    if (submitted) return;
    setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }));
  };

  const retry = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <section className="lesson-quiz" aria-label={quiz.name}>
      <div className="quiz-heading">
        <div><span>Knowledge check</span><h3>{quiz.name}</h3></div>
        <strong>{quiz.questions.length} questions</strong>
      </div>
      {quiz.questions.map((question, questionIndex) => {
        const selected = answers[questionIndex];
        const hasAnswerKey = question.correctOptionIndex !== undefined;
        return <fieldset className="quiz-question" key={`${questionIndex}-${question.prompt}`}>
          <legend><span>{questionIndex + 1}</span><SafeRichText html={question.promptHtml} fallback={question.prompt} /></legend>
          <div className="quiz-options">
            {question.options.map((option, optionIndex) => {
              const chosen = selected === optionIndex;
              const correct = submitted && hasAnswerKey && question.correctOptionIndex === optionIndex;
              const incorrect = submitted && hasAnswerKey && chosen && !correct;
              const className = ["quiz-option", chosen ? "selected" : "", correct ? "correct" : "", incorrect ? "incorrect" : ""].filter(Boolean).join(" ");
              return <button type="button" className={className} aria-pressed={chosen} onClick={() => chooseAnswer(questionIndex, optionIndex)} key={`${optionIndex}-${option.text}`}>
                {correct ? <CheckCircle2 size={19} /> : incorrect ? <XCircle size={19} /> : chosen ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                <SafeRichText html={option.html} fallback={option.text} />
              </button>;
            })}
          </div>
          {submitted && (question.explanation || question.explanationHtml) && <div className="quiz-explanation"><strong>{hasAnswerKey ? "Answer" : "Review note"}</strong><SafeRichText html={question.explanationHtml} fallback={question.explanation} /></div>}
        </fieldset>;
      })}
      {!submitted ? <button type="button" className="primary-button wide quiz-submit" disabled={!allAnswered} onClick={() => setSubmitted(true)}><CheckCircle2 size={18} /> Review answers</button> : <div className="quiz-result" aria-live="polite">
        <div><span>{score === null ? "Responses reviewed" : `${score}% on keyed questions`}</span><small>{answerKeyCount < quiz.questions.length ? `${answerKeyCount} of ${quiz.questions.length} captured questions include a verifiable answer key.` : `${correctCount} of ${answerKeyCount} correct.`}</small></div>
        <button type="button" className="icon-button" onClick={retry} aria-label="Retry quiz"><RotateCcw size={18} /></button>
      </div>}
    </section>
  );
}
