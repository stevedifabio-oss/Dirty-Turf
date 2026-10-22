import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityComment, CommunityPost, Member } from "../domain";
import { CommunityView } from "./Community";

// Run the real component handlers and rerenders without adding a DOM dependency.
const hooks = vi.hoisted(() => ({ active: null as null | { slots: any[]; cursor: number } }));
vi.mock("react", async importOriginal => {
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
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useMemo: (factory: () => any) => factory(),
    useEffect: () => undefined,
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
  if (!element) throw new Error("Expected control not found");
  return element;
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node === "boolean") return "";
  if (typeof node === "object") return "props" in node ? text((node as Element).props.children) : "";
  return String(node);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function post(id: number): CommunityPost {
  return { id, cloudId: `post-${id}`, name: `Discussion ${id}`, author: "Operator", body: "Details", replies: 0, age: "Today", likes: 0, liked: false, saved: false };
}
function comment(id: number): CommunityComment {
  return { id, cloudId: `comment-${id}`, postId: 1, author: "Operator", body: "Advice", age: "Today", likes: 0, liked: false };
}
function view(overrides: Partial<ComponentProps<typeof CommunityView>> = {}) {
  const state = { slots: [] as any[], cursor: 0 };
  const rows = { posts: [post(1), post(2)], comments: [comment(10), comment(11)], members: [] as Member[] };
  const props: ComponentProps<typeof CommunityView> = {
    posts: rows.posts, comments: rows.comments, members: rows.members, events: [],
    onPostsChange: next => { rows.posts = typeof next === "function" ? next(rows.posts) : next; },
    onCommentsChange: next => { rows.comments = typeof next === "function" ? next(rows.comments) : next; },
    onMembersChange: next => { rows.members = typeof next === "function" ? next(rows.members) : next; },
    onRequestedPostOpened: vi.fn(), onToggleFollow: vi.fn(), onLoadMorePosts: vi.fn(), hasMorePosts: false, loadingMorePosts: false,
    onCreatePost: vi.fn(), onCreateComment: vi.fn(), onToggleLike: vi.fn().mockResolvedValue(true),
    onToggleCommentLike: vi.fn().mockResolvedValue(true), onToggleBookmark: vi.fn().mockResolvedValue(true),
    onReport: vi.fn(), onBlockMember: vi.fn(), onLoadBlockedMembers: vi.fn(), onRefreshCommunity: vi.fn(), onNavigate: vi.fn(), onToast: vi.fn(),
    ...overrides,
  };
  const render = () => {
    state.cursor = 0; hooks.active = state;
    try { return CommunityView({ ...props, ...rows }); } finally { hooks.active = null; }
  };
  return { rows, props, render };
}
function postLike(tree: ReactNode, id: number) {
  const article = find(tree, e => e.type === "article" && e.key === String(id));
  return find(article, e => e.type === "button" && text(e.props.children) === " Like");
}
function commentLike(tree: ReactNode, id: number) {
  const article = find(tree, e => e.type === "article" && e.key === String(id));
  return find(article, e => e.type === "button" && e.props.className !== undefined);
}
const submit = { preventDefault: vi.fn() };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.stubGlobal("window", { location: { href: "https://example.invalid/?view=community" }, history: { state: null, replaceState: vi.fn() }, scrollTo: vi.fn() });
  vi.stubGlobal("document", { querySelector: () => null });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Community asynchronous interactions", () => {
  it("rolls back only the failed post reaction and blocks duplicate writes to that reaction", async () => {
    const first = deferred<boolean>();
    const onToggleLike = vi.fn().mockImplementation((row: CommunityPost) => row.id === 1 ? first.promise : Promise.resolve(true));
    const community = view({ onToggleLike });
    const stale = postLike(community.render(), 1);
    stale.props.onClick(); stale.props.onClick();
    expect(onToggleLike).toHaveBeenCalledOnce();
    expect(postLike(community.render(), 1).props.disabled).toBe(true);
    postLike(community.render(), 2).props.onClick();
    await flush();
    community.rows.posts[0] = { ...community.rows.posts[0], saved: true };
    first.reject(new Error("Offline")); await flush();
    expect(community.rows.posts.map(row => [row.liked, row.likes])).toEqual([[false, 0], [true, 1]]);
    expect(community.rows.posts[0].saved).toBe(true);
    expect(postLike(community.render(), 1).props.disabled).toBe(false);
  });

  it("preserves successful sibling comment reactions and newer comment text during rollback", async () => {
    const first = deferred<boolean>();
    const community = view({ onToggleCommentLike: vi.fn((row: CommunityComment) => row.id === 10 ? first.promise : Promise.resolve(true)) });
    find(community.render(), e => e.props["aria-label"] === "Open Discussion 1").props.onClick();
    commentLike(community.render(), 10).props.onClick();
    commentLike(community.render(), 11).props.onClick();
    await flush();
    community.rows.comments[0] = { ...community.rows.comments[0], body: "Updated advice" };
    first.reject(new Error("Offline")); await flush();
    expect(community.rows.comments.map(row => [row.liked, row.likes])).toEqual([[false, 0], [true, 1]]);
    expect(community.rows.comments[0].body).toBe("Updated advice");
  });

  it("rolls back one bookmark without replacing other post changes", async () => {
    const save = deferred<boolean>();
    const community = view({ onToggleBookmark: vi.fn(() => save.promise) });
    find(community.render(), e => typeof e.type === "function" && e.type.name === "PostMenu" && e.props.post.id === 1).props.onBookmark();
    postLike(community.render(), 2).props.onClick(); await flush();
    save.reject(new Error("Offline")); await flush();
    expect(community.rows.posts[0].saved).toBe(false);
    expect(community.rows.posts[1].liked).toBe(true);
  });

  it("locks a submitted post draft, prevents duplicate submissions, and preserves arriving feed rows", async () => {
    const save = deferred<CommunityPost>();
    const onCreatePost = vi.fn(() => save.promise);
    const community = view({ onCreatePost });
    find(community.render(), e => e.props.className === "composer-prompt").props.onClick();
    find(community.render(), e => e.props["aria-label"] === "Post title").props.onChange({ target: { value: "Submitted title" } });
    find(community.render(), e => e.props["aria-label"] === "Post body").props.onChange({ target: { value: "Submitted details" } });
    const form = find(community.render(), e => e.props.className === "full-composer");
    const pending = form.props.onSubmit(submit); void form.props.onSubmit(submit);
    const locked = find(community.render(), e => e.props["aria-label"] === "Post body");
    expect(locked.props.disabled).toBe(true);
    locked.props.onChange({ target: { value: "A later draft" } });
    expect(find(community.render(), e => e.props["aria-label"] === "Post body").props.value).toBe("Submitted details");
    expect(onCreatePost).toHaveBeenCalledOnce();
    community.rows.posts = [post(3), ...community.rows.posts];
    save.resolve({ ...post(4), body: "Submitted details" }); await pending;
    expect(community.rows.posts.map(row => row.id)).toEqual([4, 3, 1, 2]);
  });

  it("appends a saved thread reply to current comments and increments the current reply count", async () => {
    const save = deferred<CommunityComment>();
    const onCreateComment = vi.fn(() => save.promise);
    const community = view({ onCreateComment });
    find(community.render(), e => e.props["aria-label"] === "Open Discussion 1").props.onClick();
    find(community.render(), e => e.props.id === "thread-reply").props.onChange({ target: { value: "Submitted reply" } });
    const form = find(community.render(), e => e.props.className === "reply-composer");
    const pending = form.props.onSubmit(submit); void form.props.onSubmit(submit);
    expect(onCreateComment).toHaveBeenCalledOnce();
    expect(find(community.render(), e => e.props.id === "thread-reply").props.disabled).toBe(true);
    community.rows.comments.push(comment(12));
    community.rows.posts[0] = { ...community.rows.posts[0], replies: 3 };
    save.resolve({ ...comment(13), body: "Submitted reply" }); await pending;
    expect(community.rows.comments.map(row => row.id)).toEqual([10, 11, 12, 13]);
    expect(community.rows.posts[0].replies).toBe(4);
    expect(find(community.render(), e => e.props.id === "thread-reply").props.value).toBe("");
  });

  it("keeps a failed quick-reply draft and makes its editor available for retry", async () => {
    const save = deferred<CommunityComment>();
    const onCreateComment = vi.fn(() => save.promise);
    const community = view({ onCreateComment });
    find(community.render(), e => e.props.id === "quick-reply-1").props.onChange({ target: { value: "Retry this reply" } });
    const form = find(community.render(), e => e.props.className === "quick-reply");
    form.props.onSubmit(submit); form.props.onSubmit(submit);
    expect(onCreateComment).toHaveBeenCalledOnce();
    const locked = find(community.render(), e => e.props.id === "quick-reply-1");
    expect(locked.props.disabled).toBe(true);
    locked.props.onChange({ target: { value: "Changed while saving" } });
    save.reject(new Error("Offline")); await flush();
    const retry = find(community.render(), e => e.props.id === "quick-reply-1");
    expect(retry.props.value).toBe("Retry this reply");
    expect(retry.props.disabled).toBe(false);
  });
});
