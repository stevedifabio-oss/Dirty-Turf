import type { ComponentProps, ReactElement, ReactNode } from "react";
vi.mock("./GrowthAdmin", () => ({ GrowthAdmin: () => null }));
vi.mock("./CommunityScheduler", () => ({ CommunityScheduler: () => null }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminCourse, AdminSnapshot } from "../lib/adminBackend";
import type { LessonContentBlock } from "../lib/lessonContent";
import { AdminStudio } from "./AdminStudio";

// Run real component handlers/effects with persistent hook state, as in the
// Community and workspace-resume interaction suites; no new DOM dependency.
type HookState = { slots: any[]; cursor: number; effects: (() => void)[] };
const hooks = vi.hoisted(() => ({ active: null as HookState | null, contexts: new Map<any, any>(), nextId: 0 }));
const backend = vi.hoisted(() => ({ load: vi.fn(), saveCourse: vi.fn(), saveLesson: vi.fn(), uploadLesson: vi.fn(), uploadBlock: vi.fn(), loadBlockMedia: vi.fn() }));
vi.mock("../lib/adminBackend", () => ({
  MemberInvitePartialFailure: class MemberInvitePartialFailure extends Error {},
  loadAdminSnapshot: backend.load, saveAdminCourse: backend.saveCourse,
  createAdminMember: vi.fn(), issueAdminCertificate: vi.fn(), moderateAdminPost: vi.fn(), removeAdminComment: vi.fn(), revokeAdminCertificate: vi.fn(),
  runMemberInviteAction: vi.fn(), saveAdminCategory: vi.fn(), saveAdminEvent: vi.fn(), saveAdminLesson: backend.saveLesson, saveAdminModule: vi.fn(),
  saveCertificateTemplate: vi.fn(), setAdminMemberCourseAccess: vi.fn(), updateAdminMember: vi.fn(), updateAdminReport: vi.fn(), uploadAdminLessonAsset: backend.uploadLesson,
  uploadAdminLessonBlockAsset: backend.uploadBlock, loadAdminLessonBlockMedia: backend.loadBlockMedia,
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  const next = () => {
    if (!hooks.active) throw new Error("Render through the Admin Studio hook harness");
    return { state: hooks.active, index: hooks.active.cursor++ };
  };
  const same = (left: any[] | undefined, right: any[] | undefined) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  return {
    ...actual,
    useState: (initial: any) => { const { state, index } = next(); if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useId: () => { const { state, index } = next(); return state.slots[index] ??= `admin-test-${++hooks.nextId}`; },
    useContext: (context: any) => hooks.contexts.has(context) ? hooks.contexts.get(context) : context._currentValue,
    useCallback: (callback: any, deps: any[]) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) state.slots[index] = { deps, value: callback }; return state.slots[index].value; },
    useMemo: (factory: () => any, deps: any[]) => { const { state, index } = next(); if (!same(state.slots[index]?.deps, deps)) state.slots[index] = { deps, value: factory() }; return state.slots[index].value; },
    useEffect: (effect: () => void | (() => void), deps: any[] | undefined) => {
      const { state, index } = next();
      if (!same(state.slots[index]?.deps, deps)) {
        const previous = state.slots[index];
        state.slots[index] = { deps };
        state.effects.push(() => { previous?.cleanup?.(); state.slots[index].cleanup = effect(); });
      }
    },
  };
});

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function find(node: ReactNode, predicate: (element: Element) => boolean) {
  const element = elements(node).find(predicate);
  if (!element) throw new Error("Expected Admin Studio control not found");
  return element;
}
function component(node: ReactNode, name: string) {
  return find(node, element => typeof element.type === "function" && element.type.name === name);
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node === "boolean") return "";
  return typeof node === "object" ? "props" in node ? text((node as Element).props.children) : "" : String(node);
}
function button(node: ReactNode, label: string) {
  return find(node, element => element.type === "button" && text(element.props.children).trim() === label);
}
const allHarnesses: Array<{ dispose: () => void }> = [];
function harness(renderComponent: () => ReactNode) {
  const state: HookState = { slots: [], cursor: 0, effects: [] };
  const result = {
    render: () => {
      state.cursor = 0; hooks.active = state;
      let tree: ReactNode;
      try { tree = renderComponent(); } finally { hooks.active = null; }
      // Bind only the actual provider exposed by the root; children consume the
      // same draft registry without exporting production internals.
      for (const element of elements(tree)) {
        if (typeof element.type === "object" && element.type && "value" in element.props && "Provider" in element.type) hooks.contexts.set(element.type, element.props.value);
      }
      state.effects.splice(0).forEach(effect => effect());
      return tree;
    },
    dispose: () => { for (const slot of state.slots) slot?.cleanup?.(); state.slots = []; },
  };
  allHarnesses.push(result);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };
function course(id = "original-course", title = "Existing training"): AdminCourse {
  return { id, title, description: "Current training", category: "Core", instructorName: "Steve DiFabio", accessType: "open", requiredLevel: null, priceCents: null, sortOrder: 0, status: "draft", modules: [] };
}
function snapshot(courses = [course()]): AdminSnapshot {
  return { communityId: "community", organizationId: "organization", communityName: "Dirty Turf Academy", courses, members: [], events: [], categories: [], posts: [], reports: [], templates: [], certificates: [], quizAttemptCount: 0 };
}
async function workspace(overrides: Partial<ComponentProps<typeof AdminStudio>> = {}) {
  const props: ComponentProps<typeof AdminStudio> = { onToast: vi.fn(), onContentChange: vi.fn(), ...overrides };
  const root = harness(() => AdminStudio(props));
  root.render(); await flush();
  button(root.render(), "Courses").props.onClick();
  let courseElement = component(root.render(), "CoursesAdmin");
  const courses = harness(() => (courseElement.type as (props: any) => ReactNode)(courseElement.props));
  const renderCourses = () => { courseElement = component(root.render(), "CoursesAdmin"); return courses.render(); };
  const openForm = () => {
    button(renderCourses(), "New course").props.onClick();
    let formElement = component(renderCourses(), "CourseForm");
    const form = harness(() => (formElement.type as (props: any) => ReactNode)(formElement.props));
    const render = () => { formElement = component(renderCourses(), "CourseForm"); return form.render(); };
    const setTitle = (title: string) => {
      find(render(), element => element.type === "input" && element.props.maxLength === 160).props.onChange({ target: { value: title } });
      render();
    };
    const save = () => {
      const title = find(render(), element => element.type === "input" && element.props.maxLength === 160).props.value;
      return formElement.props.onSave({ title, description: "", category: "Core", instructorName: "Steve DiFabio", accessType: "open", status: "draft", sortOrder: 1 }) as Promise<boolean>;
    };
    return { render, setTitle, save, dispose: form.dispose };
  };
  return { props, root, renderCourses, openForm, action: () => component(root.render(), "CoursesAdmin").props.act as (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean> };
}

async function newLessonWorkspace() {
  const training = course();
  training.modules = [{ id: "module-one", courseId: training.id, title: "Fundamentals", groupTitle: "Start here", sortOrder: 0, dripAfterDays: null, lessons: [] }];
  backend.load.mockResolvedValue(snapshot([training]));
  const studio = await workspace();
  let moduleElement = component(studio.renderCourses(), "ModuleEditor");
  const module = harness(() => (moduleElement.type as (props: any) => ReactNode)(moduleElement.props));
  let editorElement = component(module.render(), "LessonComposer");
  const editor = harness(() => (editorElement.type as (props: any) => ReactNode)(editorElement.props));
  const render = () => {
    moduleElement = component(studio.renderCourses(), "ModuleEditor");
    editorElement = component(module.render(), "LessonComposer");
    return editor.render();
  };
  const builder = () => component(render(), "LessonContentEditor");
  const setTitle = (value: string) => {
    find(render(), element => element.type === "input" && element.props.required && !element.props.type).props.onChange({ target: { value } });
    render();
  };
  const setBlocks = (value: LessonContentBlock[]) => { builder().props.onChange(value); render(); };
  const setFile = (id: string, file: File) => { builder().props.onFileChange(id, file); render(); };
  const submit = async () => { find(render(), element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() }); await flush(); render(); await flush(); };
  return { studio, render, builder, setTitle, setBlocks, setFile, submit };
}

const draftLessonId = "30000000-0000-4000-8000-000000000003";
const photoPath = "10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000003/40000000-0000-4000-8000-000000000004-photo.png";
const videoPath = "10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000003/50000000-0000-4000-8000-000000000005-demo.mp4";
const sampleFile = (name: string, type: string) => ({ name, type, size: 1024 }) as File;

beforeEach(() => {
  hooks.contexts.clear(); hooks.nextId = 0;
  backend.load.mockReset().mockResolvedValue(snapshot());
  backend.saveCourse.mockReset().mockResolvedValue("new-course");
  backend.saveLesson.mockReset().mockResolvedValue("quiz-lesson");
  backend.uploadLesson.mockReset().mockResolvedValue("asset-reference");
  backend.uploadBlock.mockReset().mockResolvedValue({ path: photoPath, previewUrl: "https://example.test/signed/photo.png" });
  backend.loadBlockMedia.mockReset().mockResolvedValue({});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:lesson-test-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true) });
});
afterEach(() => { allHarnesses.splice(0).reverse().forEach(item => item.dispose()); hooks.contexts.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Admin Studio authoring interactions", () => {
  it("keeps a cleared course price empty while editing, then submits numeric cents", async () => {
    const studio = await workspace(), form = studio.openForm(); form.setTitle("Editable course price");
    const price = () => find(find(form.render(), e => e.type === "label" && text(e.props.children).startsWith("Price (USD)")), e => e.type === "input");
    price().props.onChange({ target: { value: "" } });
    expect(price().props.value).toBe("");
    expect(price().props).toMatchObject({ type: "number", min: "0", step: "0.01", required: true });
    price().props.onChange({ target: { value: "29.95" } });
    find(form.render(), e => e.type === "form").props.onSubmit({ preventDefault: vi.fn() }); await flush();
    expect(backend.saveCourse.mock.calls[0][0].priceCents).toBe(2995);
  });

  it("keeps cleared lesson minutes empty while editing, then submits numeric seconds", async () => {
    const editor = await newLessonWorkspace(); editor.setTitle("Editable lesson duration");
    const minutes = () => find(find(editor.render(), e => e.type === "label" && text(e.props.children).startsWith("Minutes")), e => e.type === "input");
    minutes().props.onChange({ target: { value: "" } });
    expect(minutes().props.value).toBe("");
    expect(minutes().props).toMatchObject({ type: "number", min: "0" });
    minutes().props.onChange({ target: { value: "12" } }); await editor.submit();
    expect(backend.saveLesson.mock.calls[0][0].durationSeconds).toBe(720);
  });

  it("lets a required member level be cleared and replaced without changing its native constraints", async () => {
    const studio = await workspace(), form = studio.openForm(); form.setTitle("Member level draft");
    find(find(form.render(), e => e.type === "label" && text(e.props.children).startsWith("Access")), e => e.type === "select").props.onChange({ target: { value: "level" } });
    const level = () => find(find(form.render(), e => e.type === "label" && text(e.props.children).startsWith("Required level")), e => e.type === "input");
    level().props.onChange({ target: { value: "" } }); expect(level().props.value).toBe("");
    expect(level().props).toMatchObject({ type: "number", min: "1", step: "1", required: true });
    level().props.onChange({ target: { value: "3" } });
    find(form.render(), e => e.type === "form").props.onSubmit({ preventDefault: vi.fn() }); await flush();
    expect(backend.saveCourse.mock.calls[0][0]).toMatchObject({ requiredLevel: 3, priceCents: null });
  });

  it("keeps quiz numeric drafts empty when cleared, holds a blank score, and saves numeric answers after replacement", async () => {
    const editor = await newLessonWorkspace(); editor.setTitle("Numeric quiz edit");
    find(find(editor.render(), e => e.type === "label" && text(e.props.children).startsWith("Type")), e => e.type === "select").props.onChange({ target: { value: "quiz" } });
    find(find(editor.render(), e => e.type === "label" && text(e.props.children) === "Question"), e => e.type === "input").props.onChange({ target: { value: "First step?" } });
    find(find(editor.render(), e => e.type === "label" && text(e.props.children) === "Answer choices"), e => e.type === "textarea").props.onChange({ target: { value: "Inspect\nRinse" } });
    const correct = () => find(find(editor.render(), e => e.type === "label" && text(e.props.children).startsWith("Correct choice number")), e => e.type === "input");
    const passing = () => find(find(editor.render(), e => e.type === "label" && text(e.props.children).startsWith("Passing score")), e => e.type === "input");
    correct().props.onChange({ target: { value: "" } }); expect(correct().props.value).toBe("");
    expect(correct().props).toMatchObject({ type: "number", min: "1", max: 2, required: true });
    expect(button(editor.render(), "Save lesson").props.disabled).toBe(true);
    correct().props.onChange({ target: { value: "2" } });
    passing().props.onChange({ target: { value: "" } }); expect(passing().props.value).toBe("");
    expect(passing().props).toMatchObject({ type: "number", min: "1", max: "100" });
    expect(passing().props.required).toBeUndefined(); await editor.submit();
    expect(backend.saveLesson).not.toHaveBeenCalled(); expect(text(editor.render())).toContain("Choose a passing score from 1 to 100");
    passing().props.onChange({ target: { value: "75" } }); await editor.submit();
    expect(backend.saveLesson.mock.calls[0][0].body.quiz).toMatchObject({ passingPercent: 75, questions: [{ correctOptionIndex: 1 }] });
  });

  it("holds videos above the hosted 50 MB cap in the actual file picker before saving or uploading", async () => {
    const editor = await newLessonWorkspace();
    editor.setBlocks([{ id: "video", type: "video", url: "", caption: "Demonstration" }]);
    let builderElement = editor.builder();
    const builder = harness(() => (builderElement.type as (props: any) => ReactNode)(builderElement.props));
    const render = () => { builderElement = editor.builder(); return builder.render(); };
    const picker = () => find(render(), element => element.type === "input" && element.props.type === "file");
    picker().props.onChange({ target: { files: [{ name: "too-large.mp4", type: "video/mp4", size: 50_000_001 }], value: "" } });
    expect(text(render())).toContain("up to 50 MB");
    expect(text(render())).toContain("Use a video link for a larger video");
    expect(editor.builder().props.files).toEqual({});
    expect(backend.saveLesson).not.toHaveBeenCalled(); expect(backend.uploadBlock).not.toHaveBeenCalled();
    const allowed = { name: "allowed.mp4", type: "video/mp4", size: 50_000_000 };
    picker().props.onChange({ target: { files: [allowed], value: "" } });
    expect(editor.builder().props.files.video).toBe(allowed);
  });

  it.each(["source-archived", "source-hidden"] as const)("labels a %s module and prevents composing hidden lessons or publishing only hidden content", async visibility => {
    const training = course();
    training.modules = [{ id: "retired-module", courseId: training.id, title: "Previous source module", groupTitle: "", sortOrder: 0, dripAfterDays: null, memberVisibility: visibility,
      lessons: [{ id: "hidden-lesson", moduleId: "retired-module", title: "Previous lesson", lessonType: "guide", body: { text: "Preserved source lesson" }, videoUrl: "", transcript: "", resources: [], durationSeconds: 0, sortOrder: 0, status: "published" }] }];
    backend.load.mockResolvedValue(snapshot([training]));
    const studio = await workspace();
    const courses = studio.renderCourses();
    expect(button(courses, "Publish course").props.disabled).toBe(true);
    expect(find(courses, e => e.type === "span" && Array.isArray(e.props.children) && e.props.children[1] === " published lessons").props.children[0]).toBe(0);
    const moduleElement = component(courses, "ModuleEditor");
    const module = harness(() => (moduleElement.type as (props: any) => ReactNode)(moduleElement.props));
    const tree = module.render();
    expect(text(tree)).toContain("hidden from members");
    expect(text(tree)).toContain("Use Add module above");
    expect(elements(tree).some(e => typeof e.type === "function" && e.type.name === "LessonComposer")).toBe(false);
    expect(elements(tree).some(e => e.type === "button" && text(e.props.children).trim() === "Edit module")).toBe(false);
    expect(component(tree, "LessonRow").props.busy).toBe("hidden-source-module");
    button(courses, "Course settings").props.onClick();
    const formElement = component(studio.renderCourses(), "CourseForm");
    const form = harness(() => (formElement.type as (props: any) => ReactNode)(formElement.props));
    expect(find(form.render(), e => e.type === "option" && e.props.value === "published").props.disabled).toBe(true);
    expect(backend.saveCourse).not.toHaveBeenCalled(); expect(backend.saveLesson).not.toHaveBeenCalled();
  });

  it("defaults additional courses to a separate paid draft without opening sales", async () => {
    const studio = await workspace();
    const form = studio.openForm();
    form.setTitle("Additional specialist training");
    find(form.render(), element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    await flush();
    expect(backend.saveCourse).toHaveBeenCalledOnce();
    expect(backend.saveCourse.mock.calls[0][0]).toMatchObject({ title: "Additional specialist training", accessType: "purchase", priceCents: 14995, status: "draft" });
  });
  it("saves mixed text, video, photo and link blocks in their chosen order without uploading or storing preview URLs", async () => {
    const editor = await newLessonWorkspace();
    const blocks: LessonContentBlock[] = [
      { id: "intro", type: "text", text: "Start with an inspection." },
      { id: "video", type: "video", url: "https://example.test/demo.mp4", caption: "The complete process" },
      { id: "photo", type: "image", url: "https://example.test/setup.png", alt: "Cleaning equipment laid out safely", caption: "Equipment setup" },
      { id: "link", type: "link", url: "https://example.test/checklist.pdf", label: "Equipment checklist" },
    ];
    editor.setTitle("Mixed content lesson");
    editor.setBlocks(blocks);
    await editor.submit();

    expect(backend.saveLesson).toHaveBeenCalledOnce();
    const saved = backend.saveLesson.mock.calls[0][0];
    expect(saved).toMatchObject({ title: "Mixed content lesson", lessonType: "video", status: "draft", body: { contentBlocks: blocks } });
    expect(saved.body.html.indexOf("Start with an inspection.")).toBeLessThan(saved.body.html.indexOf("demo.mp4"));
    expect(saved.body.html.indexOf("demo.mp4")).toBeLessThan(saved.body.html.indexOf("setup.png"));
    expect(saved.body.html.indexOf("setup.png")).toBeLessThan(saved.body.html.indexOf("checklist.pdf"));
    expect(JSON.stringify(saved)).not.toContain("blob:");
    expect(backend.uploadBlock).not.toHaveBeenCalled();
  });

  it("keeps one new draft ID and selected file after a block upload failure, then finishes that same draft on retry", async () => {
    const editor = await newLessonWorkspace();
    const photo = sampleFile("equipment.png", "image/png");
    const blocks: LessonContentBlock[] = [{ id: "photo", type: "image", url: "", alt: "Equipment setup", caption: "" }];
    backend.saveLesson.mockResolvedValue(draftLessonId);
    backend.uploadBlock.mockRejectedValueOnce(new Error("Upload connection lost"));
    editor.setTitle("Keep this upload draft"); editor.setBlocks(blocks); editor.setFile("photo", photo);

    await editor.submit();

    expect(backend.saveLesson).toHaveBeenCalledOnce();
    expect(backend.saveLesson.mock.calls[0][0]).toMatchObject({ title: "Keep this upload draft", status: "draft", body: {} });
    expect(backend.saveLesson.mock.calls[0][0].id).toBeUndefined();
    expect(backend.uploadBlock).toHaveBeenCalledWith(photo, "original-course", draftLessonId);
    expect(editor.builder().props.blocks).toEqual(blocks);
    expect(editor.builder().props.files.photo).toBe(photo);
    expect(text(find(editor.render(), element => element.props.role === "alert"))).toContain("Your draft is kept");
    expect(editor.studio.props.onContentChange).not.toHaveBeenCalled();

    await editor.submit();

    expect(backend.saveLesson.mock.calls.filter(([value]) => !value.id)).toHaveLength(1);
    expect(backend.saveLesson).toHaveBeenCalledTimes(2);
    expect(backend.uploadBlock).toHaveBeenCalledTimes(2);
    expect(backend.saveLesson.mock.calls[1][0]).toMatchObject({ id: draftLessonId, title: "Keep this upload draft", body: { contentBlocks: [{ ...blocks[0], url: `academy-asset:${photoPath}` }] } });
    expect(JSON.stringify(backend.saveLesson.mock.calls)).not.toContain("blob:");
    expect(editor.builder().props.files).toEqual({});
    expect(editor.builder().props.blocks).toEqual([]);
  });

  it("retries a final lesson-save failure without another draft insertion or re-uploading its registered file", async () => {
    const editor = await newLessonWorkspace();
    const photo = sampleFile("inspection.png", "image/png");
    backend.saveLesson.mockResolvedValueOnce(draftLessonId).mockRejectedValueOnce(new Error("Final lesson save failed")).mockResolvedValueOnce(draftLessonId);
    editor.setTitle("Recover the final save");
    editor.setBlocks([{ id: "photo", type: "image", url: "", alt: "Inspection photo", caption: "" }]);
    editor.setFile("photo", photo);

    await editor.submit();

    expect(backend.saveLesson).toHaveBeenCalledTimes(2);
    expect(backend.uploadBlock).toHaveBeenCalledOnce();
    expect(editor.builder().props.files.photo).toBe(photo);
    expect(editor.studio.props.onToast).toHaveBeenLastCalledWith("Final lesson save failed");
    expect(editor.studio.props.onContentChange).not.toHaveBeenCalled();

    await editor.submit();

    expect(backend.uploadBlock).toHaveBeenCalledOnce();
    expect(backend.saveLesson).toHaveBeenCalledTimes(3);
    expect(backend.saveLesson.mock.calls.filter(([value]) => !value.id)).toHaveLength(1);
    expect(backend.saveLesson.mock.calls.slice(1).map(([value]) => value.id)).toEqual([draftLessonId, draftLessonId]);
    expect(backend.saveLesson.mock.calls[2][0].body.contentBlocks[0].url).toBe(`academy-asset:${photoPath}`);
    expect(JSON.stringify(backend.saveLesson.mock.calls)).not.toContain("blob:");
    expect(editor.studio.props.onContentChange).toHaveBeenCalledOnce();
  });

  it("keeps the first registered file when a later block upload fails and preserves block order on retry", async () => {
    const editor = await newLessonWorkspace();
    const photo = sampleFile("setup.png", "image/png");
    const video = sampleFile("demo.mp4", "video/mp4");
    const blocks: LessonContentBlock[] = [
      { id: "intro", type: "text", text: "Watch, then check the setup." },
      { id: "video", type: "video", url: "", caption: "Demo" },
      { id: "photo", type: "image", url: "", alt: "Safe equipment setup", caption: "" },
    ];
    backend.saveLesson.mockResolvedValue(draftLessonId);
    backend.uploadBlock.mockResolvedValueOnce({ path: photoPath, previewUrl: "https://example.test/signed/setup.png" }).mockRejectedValueOnce(new Error("Video upload interrupted")).mockResolvedValueOnce({ path: videoPath, previewUrl: "https://example.test/signed/demo.mp4" });
    editor.setTitle("Two files, one lesson"); editor.setBlocks(blocks);
    // File selection order differs from content order; serialization must follow blocks.
    editor.setFile("photo", photo); editor.setFile("video", video);

    await editor.submit();
    expect(backend.uploadBlock).toHaveBeenCalledTimes(2);
    expect(backend.saveLesson).toHaveBeenCalledOnce();
    await editor.submit();

    expect(backend.uploadBlock.mock.calls.map(([file]) => file)).toEqual([photo, video, video]);
    expect(backend.saveLesson.mock.calls.filter(([value]) => !value.id)).toHaveLength(1);
    expect(backend.saveLesson.mock.calls[1][0].body.contentBlocks).toEqual([blocks[0], { ...blocks[1], url: `academy-asset:${videoPath}` }, { ...blocks[2], url: `academy-asset:${photoPath}` }]);
    expect(JSON.stringify(backend.saveLesson.mock.calls)).not.toContain("blob:");
  });

  it("returns false after a failed save and preserves the course draft for retry", async () => {
    const studio = await workspace();
    const form = studio.openForm(); form.setTitle("Keep this draft");
    backend.saveCourse.mockRejectedValueOnce(new Error("Connection lost"));

    await expect(form.save()).resolves.toBe(false);

    expect(backend.saveCourse).toHaveBeenCalledOnce();
    expect(studio.props.onToast).toHaveBeenLastCalledWith("Connection lost");
    expect(studio.props.onContentChange).not.toHaveBeenCalled();
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(find(form.render(), element => element.type === "input" && element.props.maxLength === 160).props.value).toBe("Keep this draft");
    expect(button(form.render(), "Create draft course").props.disabled).toBe(false);
  });

  it("selects the saved course and closes creation, so a fresh creation begins with an empty draft", async () => {
    const studio = await workspace();
    const form = studio.openForm(); form.setTitle("Advanced turf training");
    backend.load.mockResolvedValueOnce(snapshot([course(), course("new-course", "Advanced turf training")]));

    await expect(form.save()).resolves.toBe(true);
    form.dispose();
    const saved = studio.renderCourses();

    expect(elements(saved).some(element => typeof element.type === "function" && element.type.name === "CourseForm")).toBe(false);
    expect(text(find(saved, element => element.props.className === "admin-course-heading"))).toContain("Advanced turf training");
    expect(backend.saveCourse).toHaveBeenCalledOnce();
    expect(studio.props.onContentChange).toHaveBeenCalledOnce();
    const next = studio.openForm();
    expect(find(next.render(), element => element.type === "input" && element.props.maxLength === 160).props.value).toBe("");
    expect(button(next.render(), "Create draft course").props.disabled).toBe(true);
  });

  it("permits one in-flight mutation even when stale handlers run before rerender", async () => {
    const studio = await workspace();
    const pending = deferred<void>();
    const mutation = vi.fn(() => pending.promise);
    const duplicate = vi.fn().mockResolvedValue(undefined);
    const act = studio.action();
    const first = act("course", mutation, "Course saved.");

    await expect(act("module", duplicate, "Module saved.")).resolves.toBe(false);
    expect(mutation).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
    expect(button(studio.root.render(), "Members").props.disabled).toBe(true);
    expect(find(studio.root.render(), element => element.type === "fieldset" && element.props.className === "admin-workspace-fields").props.disabled).toBe(true);
    pending.resolve(); await expect(first).resolves.toBe(true);
    expect(find(studio.root.render(), element => element.type === "fieldset" && element.props.className === "admin-workspace-fields").props.disabled).toBe(false);
    await expect(studio.action()("module", duplicate, "Module saved.")).resolves.toBe(true);
    expect(duplicate).toHaveBeenCalledOnce();
  });

  it("treats a persisted course as saved when refresh fails and retries only the read", async () => {
    const original = snapshot(); backend.load.mockResolvedValueOnce(original);
    const studio = await workspace();
    const form = studio.openForm(); form.setTitle("Saved despite refresh failure");
    backend.load.mockRejectedValueOnce(new Error("List is offline"));

    await expect(form.save()).resolves.toBe(true);
    form.dispose();
    const failedRefresh = studio.root.render();

    expect(backend.saveCourse).toHaveBeenCalledOnce();
    expect(component(failedRefresh, "CoursesAdmin").props.snapshot).toBe(original);
    expect(text(find(failedRefresh, element => element.props.role === "alert"))).toContain("List is offline");
    expect(studio.props.onToast).toHaveBeenLastCalledWith(expect.stringContaining("Draft course created. Add your first module. The list could not refresh."));
    expect(elements(studio.renderCourses()).some(element => typeof element.type === "function" && element.type.name === "CourseForm")).toBe(false);

    backend.load.mockResolvedValueOnce(snapshot([course(), course("new-course", "Saved despite refresh failure")]));
    button(failedRefresh, "Refresh").props.onClick(); await flush();

    expect(backend.saveCourse).toHaveBeenCalledOnce();
    expect(backend.load).toHaveBeenCalledTimes(3);
    expect(text(find(studio.renderCourses(), element => element.props.className === "admin-course-heading"))).toContain("Saved despite refresh failure");
    expect(elements(studio.root.render()).some(element => element.props.role === "alert")).toBe(false);
  });

  it("keeps an unsaved editor when the administrator cancels leaving its section", async () => {
    const studio = await workspace();
    const form = studio.openForm(); form.setTitle("Unsaved curriculum");
    vi.mocked(window.confirm).mockReturnValueOnce(false);

    button(studio.root.render(), "Members").props.onClick();

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(window.confirm).toHaveBeenCalledWith("You have unsaved changes. Leave this editor and discard them?");
    expect(button(studio.root.render(), "Courses").props["aria-current"]).toBe("page");
    expect(button(studio.root.render(), "Members").props["aria-current"]).toBeUndefined();
    expect(find(form.render(), element => element.type === "input" && element.props.maxLength === 160).props.value).toBe("Unsaved curriculum");
    expect(backend.saveCourse).not.toHaveBeenCalled();
  });

  it("registers a leave guard that confirms drafts, blocks pending writes and cleans up on unmount", async () => {
    const leaveGuardRef = { current: undefined as undefined | (() => boolean) };
    const studio = await workspace({ leaveGuardRef });
    expect(leaveGuardRef.current).toEqual(expect.any(Function));
    expect(leaveGuardRef.current!()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();

    const form = studio.openForm(); form.setTitle("Protected draft");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    expect(leaveGuardRef.current!()).toBe(false);
    expect(find(form.render(), element => element.type === "input" && element.props.maxLength === 160).props.value).toBe("Protected draft");
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    expect(leaveGuardRef.current!()).toBe(true);
    expect(window.confirm).toHaveBeenCalledTimes(2);

    const pending = deferred<void>();
    const saving = studio.action()("course", () => pending.promise, "Saved.");
    expect(leaveGuardRef.current!()).toBe(false);
    expect(window.confirm).toHaveBeenCalledTimes(2);
    pending.resolve(); await saving;
    studio.root.dispose();
    expect(leaveGuardRef.current).toBeUndefined();
  });

  it("keeps the draft mounted and refuses writes after becoming read-only, including a stale action handler", async () => {
    const studio = await workspace({ readOnly: false });
    const form = studio.openForm(); form.setTitle("Offline draft remains");
    const staleAction = studio.action();
    const mutation = vi.fn().mockResolvedValue(undefined);
    studio.props.readOnly = true;
    const offline = studio.root.render();

    expect(find(offline, element => element.type === "fieldset" && element.props.className === "admin-workspace-fields").props.disabled).toBe(true);
    await expect(staleAction("course", mutation, "Saved.")).resolves.toBe(false);
    await expect(studio.action()("course", mutation, "Saved.")).resolves.toBe(false);
    expect(mutation).not.toHaveBeenCalled();
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(find(form.render(), element => element.type === "input" && element.props.maxLength === 160).props.value).toBe("Offline draft remains");
    expect(studio.props.onContentChange).not.toHaveBeenCalled();
  });

  it("removes an obsolete passing quiz when its actual lesson editor saves a guide", async () => {
    const training = course();
    const originalBody = { text: "Quiz introduction", providerData: { id: "imported-quiz" }, quiz: { requiresPassing: true, passingPercent: 80, questions: [{ prompt: "First step?", options: ["Inspect", "Rinse"], correctOptionIndex: 0, explanation: "Inspect" }] } };
    training.modules = [{ id: "module-one", courseId: training.id, title: "Fundamentals", groupTitle: "Start here", sortOrder: 0, dripAfterDays: null, lessons: [{ id: "quiz-lesson", moduleId: "module-one", title: "Safety check", lessonType: "quiz", body: originalBody, videoUrl: "", transcript: "Preserved transcript", resources: [{ title: "Checklist", url: "https://example.test/checklist.pdf", type: "pdf" }], durationSeconds: 180, sortOrder: 0, status: "draft" }] }];
    backend.load.mockResolvedValueOnce(snapshot([training]));
    const studio = await workspace();
    const moduleElement = component(studio.renderCourses(), "ModuleEditor");
    const module = harness(() => (moduleElement.type as (props: any) => ReactNode)(moduleElement.props));
    const rowElement = component(module.render(), "LessonRow");
    const row = harness(() => (rowElement.type as (props: any) => ReactNode)(rowElement.props));
    button(row.render(), "Edit").props.onClick();
    const upload = find(row.render(), element => element.type === "input" && element.props.type === "file");
    expect(upload.props.disabled).toBe(true);
    upload.props.onChange({ target: { files: [{ name: "lesson.mp4", type: "video/mp4" }] } });
    expect(backend.uploadLesson).not.toHaveBeenCalled();
    const editorElement = component(row.render(), "LessonComposer");
    const editor = harness(() => (editorElement.type as (props: any) => ReactNode)(editorElement.props));
    find(editor.render(), element => element.type === "select" && element.props.value === "quiz").props.onChange({ target: { value: "guide" } });

    find(editor.render(), element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    await flush();

    expect(backend.saveLesson).toHaveBeenCalledOnce();
    expect(backend.saveLesson.mock.calls[0][0]).toMatchObject({ id: "quiz-lesson", lessonType: "guide", body: { text: "Quiz introduction", providerData: { id: "imported-quiz" } }, transcript: "Preserved transcript", resources: training.modules[0].lessons[0].resources });
    expect(backend.saveLesson.mock.calls[0][0].body).not.toHaveProperty("quiz");
    expect(originalBody.quiz.requiresPassing).toBe(true);
    expect(elements(row.render()).some(element => typeof element.type === "function" && element.type.name === "LessonComposer")).toBe(false);
  });

  it.each(["keep", "remove"] as const)("lets an administrator remove and restore a saved main video, then %s it on save without losing lesson content", async (choice) => {
    const training = course();
    const originalBody = { html: "<p>Keep this <strong>formatted introduction</strong>.</p>", providerData: { id: "imported-main-video", untouched: true } };
    const resources = [{ title: "Existing checklist", url: "https://example.test/checklist.pdf", type: "pdf" }];
    const originalVideo = `academy-asset:${videoPath}`;
    training.modules = [{ id: "module-one", courseId: training.id, title: "Fundamentals", groupTitle: "Start here", sortOrder: 0, dripAfterDays: null, lessons: [{ id: "saved-video-lesson", moduleId: "module-one", title: "Existing video lesson", lessonType: "video", body: originalBody, videoUrl: originalVideo, transcript: "Keep the original transcript", resources, durationSeconds: 240, sortOrder: 0, status: "draft" }] }];
    backend.load.mockResolvedValue(snapshot([training]));
    const studio = await workspace();
    const moduleElement = component(studio.renderCourses(), "ModuleEditor");
    const module = harness(() => (moduleElement.type as (props: any) => ReactNode)(moduleElement.props));
    const rowElement = component(module.render(), "LessonRow");
    const row = harness(() => (rowElement.type as (props: any) => ReactNode)(rowElement.props));
    button(row.render(), "Edit").props.onClick();
    const editorElement = component(row.render(), "LessonComposer");
    const editor = harness(() => (editorElement.type as (props: any) => ReactNode)(editorElement.props));

    expect(text(editor.render())).toContain("Your existing main video is kept.");
    button(editor.render(), "Remove existing video").props.onClick();
    expect(text(editor.render())).toContain("will be removed when you save");
    expect(backend.saveLesson).not.toHaveBeenCalled();
    button(editor.render(), "Keep existing video").props.onClick();
    expect(text(editor.render())).toContain("Your existing main video is kept.");
    if (choice === "remove") button(editor.render(), "Remove existing video").props.onClick();
    find(editor.render(), element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    await flush();

    expect(backend.saveLesson).toHaveBeenCalledOnce();
    expect(backend.saveLesson.mock.calls[0][0]).toMatchObject({ id: "saved-video-lesson", videoUrl: choice === "keep" ? originalVideo : "", lessonType: choice === "keep" ? "video" : "guide", body: originalBody, transcript: "Keep the original transcript", resources });
    expect(backend.uploadBlock).not.toHaveBeenCalled();
    expect(originalBody).toEqual({ html: "<p>Keep this <strong>formatted introduction</strong>.</p>", providerData: { id: "imported-main-video", untouched: true } });
  });

  it("rejects a JavaScript content link through the lesson form before creating a draft or registering selected media", async () => {
    const editor = await newLessonWorkspace();
    const photo = sampleFile("selected.png", "image/png");
    editor.setTitle("Validate before writing");
    editor.setBlocks([
      { id: "photo", type: "image", url: "", alt: "A valid selected photo", caption: "" },
      { id: "unsafe", type: "link", url: "javascript:alert(1)", label: "Invalid destination" },
    ]);
    editor.setFile("photo", photo);

    await editor.submit();

    expect(text(find(editor.render(), element => element.props.role === "alert"))).toContain("Add a valid link or upload to block 2");
    expect(backend.saveLesson).not.toHaveBeenCalled();
    expect(backend.uploadBlock).not.toHaveBeenCalled();
    expect(editor.studio.props.onContentChange).not.toHaveBeenCalled();
    expect(editor.builder().props.files.photo).toBe(photo);
    expect(editor.builder().props.blocks[1].url).toBe("javascript:alert(1)");
  });

  it.each([
    { name: "an unsupported block type", blocks: [{ id: "future-block", type: "future-layout", providerPayload: { original: true } }] },
    { name: "a malformed media URL", blocks: [{ id: "unsafe-image", type: "image", url: "javascript:alert(1)", alt: "Original description", caption: "Original caption" }] },
  ])("keeps saved content unchanged and refuses writes when an existing lesson contains $name", async ({ blocks }) => {
    const training = course();
    const originalBody = { contentBlocks: blocks, html: "<p>Original fallback content</p>", providerData: { id: "keep-malformed-source" } };
    const untouched = structuredClone(originalBody);
    training.modules = [{ id: "module-one", courseId: training.id, title: "Fundamentals", groupTitle: "Start here", sortOrder: 0, dripAfterDays: null, lessons: [{ id: "review-lesson", moduleId: "module-one", title: "Content needing review", lessonType: "guide", body: originalBody, videoUrl: "", transcript: "Original transcript", resources: [], durationSeconds: 120, sortOrder: 0, status: "draft" }] }];
    backend.load.mockResolvedValue(snapshot([training]));
    const studio = await workspace();
    const moduleElement = component(studio.renderCourses(), "ModuleEditor");
    const module = harness(() => (moduleElement.type as (props: any) => ReactNode)(moduleElement.props));
    const rowElement = component(module.render(), "LessonRow");
    const row = harness(() => (rowElement.type as (props: any) => ReactNode)(rowElement.props));
    button(row.render(), "Edit").props.onClick();
    const editorElement = component(row.render(), "LessonComposer");
    const editor = harness(() => (editorElement.type as (props: any) => ReactNode)(editorElement.props));

    expect(() => editor.render()).not.toThrow();
    const rendered = editor.render();
    expect(text(find(rendered, element => element.props.role === "alert"))).toContain("kept unchanged; saving is disabled");
    expect(component(rendered, "LessonContentEditor").props.disabled).toBe(true);
    expect(button(rendered, "Save lesson").props.disabled).toBe(true);
    // A disabled button is not the write boundary: the form handler must also refuse it.
    find(rendered, element => element.type === "form").props.onSubmit({ preventDefault: vi.fn() });
    await flush();

    expect(backend.saveLesson).not.toHaveBeenCalled();
    expect(backend.uploadBlock).not.toHaveBeenCalled();
    expect(studio.props.onContentChange).not.toHaveBeenCalled();
    expect(originalBody).toEqual(untouched);
    expect(component(row.render(), "LessonComposer")).toBeDefined();
  });
});
