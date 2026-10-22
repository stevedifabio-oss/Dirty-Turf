import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademyView } from "./Academy";
import { CommunityView } from "./Community";
import { EventsView } from "./Events";
import { HubSheet } from "./Network";
import { loadNotificationPreferences, saveNotificationPreferences } from "../lib/backend";

// Exercise real handlers and rerenders without adding a DOM test dependency.
const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number; effects: (() => void)[] } }));
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const next = () => {
    if (!hooks.active) throw new Error("Render through the component harness");
    return { state: hooks.active, index: hooks.active.cursor++ };
  };
  return {
    ...actual,
    useState: (initial: any) => {
      const { state, index } = next();
      if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }];
    },
    useRef: (value: any) => {
      const { state, index } = next();
      return state.slots[index] ??= { current: value };
    },
    useMemo: (factory: () => any) => factory(),
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const { state, index } = next();
      const previous = state.slots[index];
      if (previous && deps && deps.length === previous.deps?.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      state.effects.push(() => {
        previous?.cleanup?.();
        state.slots[index] = { deps, cleanup: effect() };
      });
    },
  };
});
vi.mock("../lib/backend", () => ({
  loadNotificationPreferences: vi.fn(), saveNotificationPreferences: vi.fn(),
  loadMemberAccessSummary: vi.fn(), loadAccountDeletionRequest: vi.fn().mockResolvedValue(null),
  loadAcademyBillingOverview: vi.fn(), webBillingAvailable: () => false,
  openAcademyBillingPortal: vi.fn(), provisionAcademyMemberAccounts: vi.fn(),
  requestAccountDeletion: vi.fn(), startAcademyCheckout: vi.fn(),
}));

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function find(node: ReactNode, predicate: (element: Element) => boolean): Element {
  const result = elements(node).find(predicate);
  if (!result) throw new Error("Expected control not found");
  return result;
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  return "props" in node ? text((node as Element).props.children) : "";
}
function harness(renderComponent: () => ReactNode) {
  const state = { slots: [] as any[], cursor: 0, effects: [] as (() => void)[] };
  return {
    render() {
      state.cursor = 0;
      hooks.active = state;
      try { return renderComponent(); } finally { hooks.active = null; }
    },
    effects() { state.effects.splice(0).forEach((run) => run()); },
    dispose() { state.slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const submitEvent = { preventDefault: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  platform.native = false;
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    location: { href: "https://app.dirtyturf.com/?view=community" },
    history: { state: null, replaceState: vi.fn() }, scrollTo: vi.fn(),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (timer: ReturnType<typeof setInterval>) => clearInterval(timer),
  }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { querySelector: () => null }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Member interaction regressions", () => {
  it("clears the old discussion reply target and draft before posting in another thread", async () => {
    const posts = [1, 2].map((id) => ({ id, cloudId: `post-${id}`, name: `Discussion ${id}`, author: "Operator", body: "Details", replies: 1, age: "Today" }));
    const comment = { id: 10, cloudId: "reply-10", postId: 1, author: "Alex", body: "Advice", age: "Today", likes: 0 };
    const onCreateComment = vi.fn().mockImplementation(async (value) => value);
    const view = harness(() => CommunityView({ posts, comments: [comment], members: [], events: [], requestedPostCloudId: undefined,
      onRequestedPostOpened: vi.fn(), onPostsChange: vi.fn(), onCommentsChange: vi.fn(), onMembersChange: vi.fn(), onToggleFollow: vi.fn(),
      onLoadMorePosts: vi.fn(), hasMorePosts: false, loadingMorePosts: false, onCreatePost: vi.fn(), onCreateComment,
      onToggleLike: vi.fn(), onToggleCommentLike: vi.fn(), onToggleBookmark: vi.fn(), onReport: vi.fn(), onBlockMember: vi.fn(),
      onLoadBlockedMembers: vi.fn(), onRefreshCommunity: vi.fn(), onNavigate: vi.fn(), onToast: vi.fn() }));
    find(view.render(), (e) => e.props["aria-label"] === "Open Discussion 1").props.onClick();
    find(view.render(), (e) => e.type === "button" && text(e.props.children) === " Reply").props.onClick();
    expect(find(view.render(), (e) => e.props.id === "thread-reply").props.value).toBe("@Alex ");
    find(view.render(), (e) => e.type === "button" && text(e.props.children).includes("Back to discussions")).props.onClick();
    find(view.render(), (e) => e.props["aria-label"] === "Open Discussion 2").props.onClick();
    expect(find(view.render(), (e) => e.props.id === "thread-reply").props.value).toBe("");
    find(view.render(), (e) => e.props.id === "thread-reply").props.onChange({ target: { value: "New discussion answer" } });
    await find(view.render(), (e) => e.type === "form").props.onSubmit(submitEvent);
    expect(onCreateComment).toHaveBeenCalledWith(expect.objectContaining({ postId: 2, parentId: undefined, parentCloudId: undefined }), "post-2");
  });

  it("prevents overlapping whole-record preference saves and allows retry after failure", async () => {
    const preferences = { emailEnabled: true, replies: true, mentions: true, reactions: true, newPosts: true, adminAnnouncements: true, eventReminders: true, courseUpdates: true, weeklyDigest: true };
    vi.mocked(loadNotificationPreferences).mockResolvedValue(preferences);
    const request = deferred<typeof preferences>();
    vi.mocked(saveNotificationPreferences).mockReturnValueOnce(request.promise).mockImplementation(async (value) => value);
    const hub = harness(() => HubSheet({ section: "settings", dataMode: "cloud", canManage: false, onClose: vi.fn(), onToast: vi.fn(), onRequestMagicLink: vi.fn(), onSignOut: vi.fn(), notifications: [], onOpenNotification: vi.fn(), onMarkAllNotificationsRead: vi.fn(), primaryNavigation: null }));
    const panel = find(hub.render(), (e) => typeof e.type === "function" && e.type.name === "SettingsPanel");
    const settings = harness(() => (panel.type as (props: any) => ReactNode)(panel.props));
    settings.render(); settings.effects(); await Promise.resolve();
    const firstView = settings.render();
    const replies = find(firstView, (e) => e.props.label === "Comments and replies");
    const mentions = find(firstView, (e) => e.props.label === "Mentions");
    replies.props.onChange(false);
    mentions.props.onChange(false); // Even a stale handler cannot start a second save.
    expect(saveNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(find(settings.render(), (e) => e.props.label === "Mentions").props.disabled).toBe(true);
    request.reject(new Error("Offline")); await request.promise.catch(() => {}); await Promise.resolve();
    const restored = find(settings.render(), (e) => e.props.label === "Comments and replies");
    expect(restored.props.checked).toBe(true);
    expect(restored.props.disabled).toBe(false);
    restored.props.onChange(false); await Promise.resolve();
    expect(saveNotificationPreferences).toHaveBeenCalledTimes(2);
    settings.dispose();
  });

  it("keeps submitted quiz answers fixed while the server records the attempt", async () => {
    const request = deferred<{ passed: boolean; requiredScore: number }>();
    const onQuizAttempt = vi.fn().mockReturnValue(request.promise);
    const quiz = { name: "Knowledge check", passingPercent: 100, requiresPassing: true, questions: [{ prompt: "Choose one", options: [{ text: "Correct" }, { text: "Wrong" }], correctOptionIndex: 0 }] };
    const courses = [{ id: "course", title: "Course", description: "Training", category: "Core", instructor: "Steve", progress: 0, duration: "1 min", access: "open" as const, modules: [{ title: "Module", lessons: [{ id: "lesson", title: "Quiz", type: "quiz" as const, duration: "1 min", completed: false, quiz }] }] }];
    const academy = harness(() => AcademyView({ courses, certificates: [], dataMode: "cloud", onCoursesChange: vi.fn(), onLessonCompletion: vi.fn(), onQuizAttempt, onRequestCertificate: vi.fn(), onToast: vi.fn(), onDiscuss: vi.fn() }));
    find(academy.render(), (e) => e.props.className === "course-card course-button").props.onClick();
    find(academy.render(), (e) => e.props.className === "lesson-row").props.onClick();
    const quizElement = find(academy.render(), (e) => typeof e.type === "function" && e.type.name === "QuizLesson");
    const lesson = harness(() => (quizElement.type as (props: any) => ReactNode)(quizElement.props));
    find(lesson.render(), (e) => e.props.className === "quiz-option").props.onClick();
    const submit = find(lesson.render(), (e) => e.props.className === "primary-button wide quiz-submit");
    submit.props.onClick(); submit.props.onClick(); // A rapid second tap uses the same handler before a rerender.
    expect(onQuizAttempt).toHaveBeenCalledOnce();
    const pending = lesson.render();
    const wrong = elements(pending).filter((e) => e.props.className?.startsWith("quiz-option"))[1];
    expect(wrong.props.disabled).toBe(true);
    wrong.props.onClick(); // Guard also protects a direct/programmatic invocation.
    request.resolve({ passed: true, requiredScore: 100 }); await request.promise; await Promise.resolve();
    expect(onQuizAttempt).toHaveBeenCalledWith("lesson", 100, [0]);
    expect(text(lesson.render())).toContain("Passed · 100%");
  });

  it.each([false, true])("preserves certificate readiness from verified imported completion (lessons completed in this app: %s)", completed => {
    const onRequestCertificate = vi.fn().mockResolvedValue(undefined);
    const courses = [{ id: "course", title: "Course", description: "Training", category: "Core", instructor: "Steve", progress: 100, importedProgress: 100, duration: "1 min", access: "open" as const, modules: [{ title: "Module", lessons: [{ id: "lesson", title: "Lesson", type: "guide" as const, duration: "1 min", completed, body: "Instructions" }] }] }];
    const academy = harness(() => AcademyView({ courses, certificates: [], dataMode: "cloud", onCoursesChange: vi.fn(), onLessonCompletion: vi.fn(), onQuizAttempt: vi.fn(), onRequestCertificate, onToast: vi.fn(), onDiscuss: vi.fn() }));
    find(academy.render(), e => e.props.className === "course-card course-button").props.onClick();
    const tree = academy.render();
    expect(text(tree)).toContain("100% complete");
    expect(text(tree)).toContain("Your certificate is ready");
    expect(text(tree).includes("Includes progress carried over")).toBe(!completed);
    expect(onRequestCertificate).not.toHaveBeenCalled();
    academy.dispose();
  });

  it("does not offer a certificate for an imported empty course", () => {
    const courses = [{ id: "course", title: "Course", description: "Training", category: "Core", instructor: "Steve", progress: 100, importedProgress: 100, duration: "0 min", access: "open" as const, modules: [] }];
    const academy = harness(() => AcademyView({ courses, certificates: [], dataMode: "cloud", onCoursesChange: vi.fn(), onLessonCompletion: vi.fn(), onQuizAttempt: vi.fn(), onRequestCertificate: vi.fn(), onToast: vi.fn(), onDiscuss: vi.fn() }));
    find(academy.render(), e => e.props.className === "course-card course-button").props.onClick();
    expect(text(academy.render())).toContain("No published lessons yet");
    expect(text(academy.render())).not.toContain("Your certificate is ready");
    academy.dispose();
  });

  it.each([
    { name: "iOS", native: true, base: "capacitor://localhost/" },
    { name: "Android", native: true, base: "https://localhost/" },
    { name: "web", native: false, base: "https://preview.example/" },
  ])("keeps $name certificate verification in its intended browsing context", ({ native, base }) => {
    platform.native = native;
    const code = "certificate /?&=#";
    const courses = [{ id: "course", title: "Course", description: "Training", category: "Core", instructor: "Steve", progress: 100, duration: "1 min", access: "open" as const, modules: [{ title: "Module", lessons: [{ id: "lesson", title: "Lesson", type: "guide" as const, duration: "1 min", completed: true, body: "Instructions" }] }] }];
    const certificate = { id: "certificate", courseId: "course", recipientName: "Test operator", courseTitle: "Course", verificationCode: code, status: "active" as const, issuedAt: "2026-10-22T12:00:00Z", certificateTitle: "Certificate of completion", certificateDescription: "completed", signatoryName: "Steve", signatoryTitle: "Instructor" };
    const academy = harness(() => AcademyView({ courses, certificates: [certificate], dataMode: "cloud", onCoursesChange: vi.fn(), onLessonCompletion: vi.fn(), onQuizAttempt: vi.fn(), onRequestCertificate: vi.fn(), onToast: vi.fn(), onDiscuss: vi.fn() }));
    find(academy.render(), e => e.props.className === "course-card course-button").props.onClick();
    const card = find(academy.render(), e => typeof e.type === "function" && e.props.certificate === certificate);
    const link = find((card.type as (props: any) => ReactNode)(card.props), e => e.type === "a" && text(e) === "Verify certificate");
    const path = `/?certificate=${encodeURIComponent(code)}`;
    expect(link.props.href).toBe(native ? path : `https://app.dirtyturf.com${path}`);
    expect(link.props.target).toBe(native ? undefined : "_blank");
    const destination = new URL(link.props.href, base);
    const expectedContext = new URL(native ? base : "https://app.dirtyturf.com/");
    expect(destination.protocol).toBe(expectedContext.protocol);
    expect(destination.host).toBe(expectedContext.host);
    expect(destination.pathname).toBe("/");
    expect([...destination.searchParams]).toEqual([["certificate", code]]);
    expect(destination.hash).toBe("");
    academy.dispose();
  });

  it("explains an empty course filter and offers a way back to the assigned courses", () => {
    const courses = [{ id: "course", title: "Core training", description: "Training", category: "Core", instructor: "Steve", progress: 0, duration: "1 min", access: "open" as const, modules: [] }];
    const academy = harness(() => AcademyView({ courses, certificates: [], dataMode: "cloud", onCoursesChange: vi.fn(), onLessonCompletion: vi.fn(), onQuizAttempt: vi.fn(), onRequestCertificate: vi.fn(), onToast: vi.fn(), onDiscuss: vi.fn() }));
    find(academy.render(), e => e.props.role === "tab" && e.props.children === "Sales").props.onClick();
    expect(text(academy.render())).toContain("No sales courses yet");
    expect(text(academy.render())).not.toContain("No courses assigned");
    find(academy.render(), e => e.type === "button" && e.props.children === "View all courses").props.onClick();
    expect(text(academy.render())).toContain("Core training");
    academy.dispose();
  });

  it("opens a course email target once content has loaded", () => {
    let courses: any[] = [];
    let requested: string | undefined = "course-target";
    const opened = vi.fn(() => { requested = undefined; });
    const academy = harness(() => AcademyView({ courses, requestedCourseCloudId: requested, onRequestedCourseOpened: opened,
      certificates: [], dataMode: "cloud", onCoursesChange: vi.fn(), onLessonCompletion: vi.fn(), onQuizAttempt: vi.fn(),
      onRequestCertificate: vi.fn(), onToast: vi.fn(), onDiscuss: vi.fn() }));
    academy.render(); academy.effects();
    expect(opened).not.toHaveBeenCalled();
    courses = [{ id: "course-target", title: "Email-linked training", description: "Lesson details", category: "Core", instructor: "Steve", progress: 0, duration: "1 min", access: "open", modules: [] }];
    academy.render(); academy.effects();
    expect(opened).toHaveBeenCalledOnce();
    expect(find(academy.render(), (e) => e.type === "h2").props.children).toBe("Email-linked training");
    academy.effects();
    expect(opened).toHaveBeenCalledOnce();
    academy.dispose();
  });

  it("rolls back only the failed lesson and prevents duplicate completion writes", async () => {
    const request = deferred<void>();
    const onLessonCompletion = vi.fn(() => request.promise);
    let courses: any[] = [{ id: "course", title: "Training", description: "", category: "Core", instructor: "Steve", progress: 0, duration: "1 min", access: "open", modules: [{ title: "Module", lessons: [
      { id: "lesson-1", title: "First", type: "guide", duration: "1 min", completed: false, body: "Read this" },
      { id: "lesson-2", title: "Second", type: "guide", duration: "1 min", completed: false, body: "Read that" },
    ] }] }];
    const academy = harness(() => AcademyView({ courses, certificates: [], dataMode: "cloud",
      onCoursesChange: (next) => { courses = typeof next === "function" ? next(courses) : next; },
      onLessonCompletion, onQuizAttempt: vi.fn(), onRequestCertificate: vi.fn(), onToast: vi.fn(), onDiscuss: vi.fn() }));
    find(academy.render(), (e) => e.props.className === "course-card course-button").props.onClick();
    find(academy.render(), (e) => e.props.className === "lesson-row").props.onClick();
    const button = find(academy.render(), (e) => e.type === "button" && text(e.props.children).includes("Mark lesson complete"));
    button.props.onClick(); button.props.onClick();
    expect(onLessonCompletion).toHaveBeenCalledOnce();
    // A separate server action has updated another lesson while this save waits.
    courses[0].modules[0].lessons[1].completed = true;
    request.reject(new Error("Offline")); await request.promise.catch(() => {}); await Promise.resolve();
    expect(courses[0].modules[0].lessons[0].completed).toBe(false);
    expect(courses[0].modules[0].lessons[1].completed).toBe(true);
    academy.dispose();
  });

  it("reveals Join at event start and removes it after end or resuming later", () => {
    vi.useFakeTimers();
    const start = Date.parse("2026-09-27T15:00:00Z");
    vi.setSystemTime(start - 1000);
    const event = { id: 1, title: "Live class", description: "Training", date: "Sep 27", time: "3:00 PM", duration: "1 min", startsAt: new Date(start).toISOString(), endsAt: new Date(start + 60000).toISOString(), host: "Steve", kind: "live" as const, attending: true, attendeeCount: 1, meetingUrl: "https://example.com/meeting" };
    const view = harness(() => EventsView({ events: [event], onEventsChange: vi.fn(), onToggleRsvp: vi.fn(), onToast: vi.fn() }));
    expect(elements(view.render()).some((e) => e.props.href === event.meetingUrl)).toBe(false);
    view.effects();
    vi.advanceTimersByTime(1000);
    expect(find(view.render(), (e) => e.props.href === event.meetingUrl).type).toBe("a");
    vi.setSystemTime(start + 60001);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(text(view.render())).toContain("Session ended");
    expect(elements(view.render()).some((e) => e.props.href === event.meetingUrl)).toBe(false);
    view.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
