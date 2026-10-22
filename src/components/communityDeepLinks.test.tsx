import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityComment, CommunityPost, Member } from "../domain";
import { CommunityView } from "./Community";

type HookState = { slots: any[]; cursor: number; pending: (() => void)[]; effects: Set<number> };
const hooks = vi.hoisted(() => ({ active: null as HookState | null }));
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
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const { state, index } = next();
      const previous = state.slots[index];
      if (previous && previous.deps.length === deps.length && deps.every((value, offset) => Object.is(value, previous.deps[offset]))) return;
      state.pending.push(() => {
        previous?.cleanup?.();
        state.slots[index] = { deps, cleanup: effect() };
        state.effects.add(index);
      });
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
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node === "boolean") return "";
  if (typeof node === "object") return "props" in node ? text((node as Element).props.children) : "";
  return String(node);
}
function find(node: ReactNode, predicate: (element: Element) => boolean) {
  const element = elements(node).find(predicate);
  if (!element) throw new Error("Expected control not found");
  return element;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const oldId = "00000000-0000-4000-8000-000000000051";
const otherId = "00000000-0000-4000-8000-000000000052";
function post(id: number, cloudId = id === 51 ? oldId : `post-${id}`): CommunityPost {
  return { id, cloudId, name: `Discussion ${id}`, author: "Operator", body: "Details", replies: 1, age: "Today", likes: 0, liked: false };
}
function comment(id: number, postId = 51): CommunityComment {
  return { id, cloudId: `comment-${id}`, postId, author: "Operator", body: `Reply ${id}`, age: "Today", likes: 0 };
}
function view(overrides: Partial<ComponentProps<typeof CommunityView>> = {}) {
  const state: HookState = { slots: [], cursor: 0, pending: [], effects: new Set() };
  const rows = { posts: [post(1)], comments: [comment(10, 1)], members: [] as Member[] };
  const props: ComponentProps<typeof CommunityView> = {
    ...rows, events: [], accessScopeKey: "account-a",
    onPostsChange: next => { rows.posts = typeof next === "function" ? next(rows.posts) : next; },
    onCommentsChange: next => { rows.comments = typeof next === "function" ? next(rows.comments) : next; },
    onMembersChange: next => { rows.members = typeof next === "function" ? next(rows.members) : next; },
    onRequestedPostOpened: vi.fn(() => { props.requestedPostCloudId = undefined; }),
    onRequestedCommentOpened: vi.fn(() => { props.requestedCommentCloudId = undefined; }),
    onToggleFollow: vi.fn(), onLoadMorePosts: vi.fn(), hasMorePosts: true, loadingMorePosts: false,
    onCreatePost: vi.fn(), onCreateComment: vi.fn(), onToggleLike: vi.fn().mockResolvedValue(true),
    onToggleCommentLike: vi.fn(), onToggleBookmark: vi.fn(), onReport: vi.fn(), onBlockMember: vi.fn(),
    onLoadBlockedMembers: vi.fn().mockResolvedValue([]), onRefreshCommunity: vi.fn(), onNavigate: vi.fn(), onToast: vi.fn(),
    ...overrides,
  };
  const render = (commitEffects = true) => {
    state.cursor = 0; hooks.active = state;
    let tree: ReactNode;
    try { tree = CommunityView({ ...props, ...rows }); } finally { hooks.active = null; }
    if (commitEffects) for (const effect of state.pending.splice(0)) effect();
    return tree;
  };
  return { rows, props, render, unmount: () => { for (const index of state.effects) state.slots[index].cleanup?.(); } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  vi.stubGlobal("window", { location: { href: "https://example.invalid/?view=community" }, history: { state: null, replaceState: vi.fn() }, scrollTo: vi.fn() });
  vi.stubGlobal("document", { querySelector: () => null, getElementById: vi.fn(() => ({ scrollIntoView })) });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("exact Community links", () => {
  it("fetches and opens an old post with replies without changing the feed or paging it", async () => {
    const load = deferred<{ post: CommunityPost; comments: CommunityComment[] } | null>();
    const onLoadRequestedPost = vi.fn(() => load.promise);
    const community = view({ requestedPostCloudId: oldId, onLoadRequestedPost });
    community.render();
    expect(text(community.render())).toContain("Opening discussion");
    // A feed refresh while the old thread loads must not restart the request.
    community.rows.posts.push(post(2)); community.rows.comments.push(comment(11, 1)); community.render();
    load.resolve({ post: post(51), comments: [comment(60)] }); await flush();
    const tree = community.render();
    expect(text(tree)).toContain("Discussion 51");
    expect(text(tree)).toContain("Reply 60");
    expect(community.rows.posts.map(row => row.id)).toEqual([1, 2]);
    expect(community.rows.comments.map(row => row.id)).toEqual([10, 11, 60]);
    expect(onLoadRequestedPost).toHaveBeenCalledExactlyOnceWith(oldId);
    expect(community.props.onLoadMorePosts).not.toHaveBeenCalled();
    find(tree, element => element.type === "button" && text(element.props.children) === " Like").props.onClick(); await flush();
    expect(find(community.render(), element => element.type === "button" && text(element.props.children) === " Like").props.className).toBe("active");
  });

  it("opens a loaded link offline and preserves its reply draft", () => {
    const community = view({ readOnly: true, requestedPostCloudId: "post-1", onLoadRequestedPost: vi.fn() });
    community.render();
    const input = find(community.render(), element => element.props.id === "thread-reply");
    input.props.onChange({ target: { value: "Save this thought" } });
    expect(find(community.render(), element => element.props.id === "thread-reply").props.value).toBe("Save this thought");
    expect(find(community.render(), element => element.props["aria-label"] === "Post comment").props.disabled).toBe(true);
    expect(community.props.onLoadRequestedPost).not.toHaveBeenCalled();
  });

  it("opens an exact locally loaded preview post without requesting a cloud UUID", () => {
    const community = view({ requestedPostCloudId: "1", onLoadRequestedPost: vi.fn() });
    community.rows.posts[0].cloudId = undefined;
    community.render();
    expect(text(community.render())).toContain("Back to discussions");
    expect(community.props.onLoadRequestedPost).not.toHaveBeenCalled();
  });

  it("opens a local member result from an existing selected thread", () => {
    const community = view({ onRequestedMemberOpened: vi.fn() });
    community.rows.members = [{ id: 7, name: "Chris Daniels", initials: "CD", company: "Example Turf", location: "Example city", role: "Owner", level: 1, points: 0, following: false }];
    community.render();
    find(community.render(), element => element.props["aria-label"] === "Open Discussion 1").props.onClick();
    expect(text(community.render())).toContain("Back to discussions");
    community.props.requestedMemberCloudId = "7";
    community.render();
    const tree = community.render();
    expect(text(tree)).toContain("Academy members");
    expect(text(tree)).toContain("Chris Daniels");
    expect(find(tree, element => element.type === "input" && element.props.placeholder === "Search name, company, or location").props.value).toBe("Chris Daniels");
    expect(community.props.onRequestedMemberOpened).toHaveBeenCalledOnce();
  });

  it("matches canonical member UUIDs regardless of case without falling back to cloud members' numeric IDs", () => {
    const id = "abcdefab-0000-4000-8000-000000000007";
    const community = view({ requestedMemberCloudId: "7", onRequestedMemberOpened: vi.fn() });
    community.rows.members = [{ id: 7, cloudId: id, name: "Cloud Operator", initials: "CO", company: "Example Turf", location: "Example city", role: "Operator", level: 1, points: 0, following: false }];
    community.render();
    expect(text(community.render())).not.toContain("Academy members");
    expect(community.props.onRequestedMemberOpened).not.toHaveBeenCalled();
    community.props.requestedMemberCloudId = id.toUpperCase();
    community.render();
    expect(text(community.render())).toContain("Academy members");
    expect(community.props.onRequestedMemberOpened).toHaveBeenCalledOnce();
  });

  it("holds an unloaded link offline, then loads it after reconnecting", async () => {
    const community = view({ readOnly: true, requestedPostCloudId: oldId, onLoadRequestedPost: vi.fn().mockResolvedValue({ post: post(51), comments: [] }) });
    community.render();
    expect(text(community.render())).toContain("Connect to open this discussion");
    expect(community.props.onLoadRequestedPost).not.toHaveBeenCalled();
    community.props.readOnly = false; community.render(); await flush();
    expect(text(community.render())).toContain("Discussion 51");
  });

  it("shows an unavailable state for missing or malformed links", async () => {
    const load = vi.fn().mockResolvedValue(null);
    const community = view({ requestedPostCloudId: oldId, onLoadRequestedPost: load });
    community.render(); await flush();
    expect(text(community.render())).toContain("Discussion unavailable");
    expect(community.props.onRequestedPostOpened).not.toHaveBeenCalled();
    community.props.requestedPostCloudId = "untrusted-filter-expression"; community.render();
    expect(text(community.render())).toContain("Discussion unavailable");
    expect(load).toHaveBeenCalledOnce();
  });

  it("accepts the same verified UUID when its hexadecimal letters use different case", async () => {
    const id = "abcdefab-0000-4000-8000-000000000051";
    const community = view({ requestedPostCloudId: id.toUpperCase(), onLoadRequestedPost: vi.fn().mockResolvedValue({ post: post(51, id), comments: [{ ...comment(60), postCloudId: id }] }) });
    community.render(); await flush();
    expect(text(community.render())).toContain("Discussion 51");
  });

  it("allows a failed exact request to retry without paginating history", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ post: post(51), comments: [] });
    const community = view({ requestedPostCloudId: oldId, onLoadRequestedPost: load });
    community.render(); await flush();
    const tree = community.render(); expect(text(tree)).toContain("Could not open this discussion");
    find(tree, element => element.type === "button" && text(element.props.children) === "Try again").props.onClick();
    community.render(); await flush();
    expect(text(community.render())).toContain("Discussion 51");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects a mismatched post or replies owned by another post", async () => {
    const load = vi.fn().mockResolvedValueOnce({ post: post(52, otherId), comments: [] }).mockResolvedValueOnce({ post: post(51), comments: [comment(60, 52)] });
    const community = view({ requestedPostCloudId: oldId, onLoadRequestedPost: load });
    community.render(); await flush();
    expect(text(community.render())).toContain("Could not open this discussion");
    find(community.render(), element => element.type === "button" && text(element.props.children) === "Try again").props.onClick();
    community.render(); await flush();
    expect(text(community.render())).toContain("Could not open this discussion");
    expect(community.rows.comments).toHaveLength(1);
  });

  it("ignores earlier request and account results after a newer identity is selected", async () => {
    const first = deferred<{ post: CommunityPost; comments: CommunityComment[] }>();
    const second = deferred<{ post: CommunityPost; comments: CommunityComment[] }>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const community = view({ requestedPostCloudId: oldId, onLoadRequestedPost: load });
    community.render(); community.props.requestedPostCloudId = otherId; community.render();
    second.resolve({ post: post(52, otherId), comments: [comment(61, 52)] }); await flush(); community.render();
    first.resolve({ post: post(51), comments: [comment(60)] }); await flush();
    expect(text(community.render())).toContain("Discussion 52");
    expect(community.rows.comments.some(row => row.postId === 51)).toBe(false);
    community.props.accessScopeKey = "account-b"; community.render();
    expect(text(community.render())).not.toContain("Discussion 52");
  });

  it("does not apply a request after an account change or unmount", async () => {
    const first = deferred<{ post: CommunityPost; comments: CommunityComment[] }>();
    const second = deferred<{ post: CommunityPost; comments: CommunityComment[] }>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const community = view({ requestedPostCloudId: oldId, onLoadRequestedPost: load });
    community.render(); community.props.accessScopeKey = "account-b"; community.props.requestedPostCloudId = undefined; community.render();
    first.resolve({ post: post(51), comments: [comment(60)] }); await flush();
    expect(community.rows.comments).toHaveLength(1);
    community.props.requestedPostCloudId = otherId; community.render(); community.unmount();
    second.resolve({ post: post(52, otherId), comments: [comment(61, 52)] }); await flush();
    expect(community.rows.comments).toHaveLength(1);
    expect(community.props.onRequestedPostOpened).not.toHaveBeenCalled();
  });

  it("invalidates an account response before passive-effect cleanup can run", async () => {
    const pending = deferred<{ post: CommunityPost; comments: CommunityComment[] }>();
    const community = view({ requestedPostCloudId: oldId, onLoadRequestedPost: vi.fn(() => pending.promise) });
    community.render();
    community.props.accessScopeKey = "account-b";
    community.props.requestedPostCloudId = undefined;
    community.render(false);
    pending.resolve({ post: post(51), comments: [comment(60)] }); await flush();
    expect(community.rows.comments).toHaveLength(1);
    expect(community.props.onRequestedPostOpened).not.toHaveBeenCalled();
    community.render();
  });

  it("navigates a matching comment only after its exact thread has opened", async () => {
    const community = view({ requestedPostCloudId: oldId, requestedCommentCloudId: "comment-60", onLoadRequestedPost: vi.fn().mockResolvedValue({ post: post(51), comments: [comment(60)] }) });
    community.render(); expect(scrollIntoView).not.toHaveBeenCalled(); await flush();
    const tree = community.render();
    expect(find(tree, element => element.props.id === "comment-comment-60")).toBeDefined();
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "center", behavior: "smooth" });
  });

  it("guards writes while offline without discarding editable drafts", () => {
    const community = view({ readOnly: true }); community.render();
    let tree = community.render();
    find(tree, element => element.type === "button" && text(element.props.children) === " Like").props.onClick();
    find(tree, element => element.props.id === "quick-reply-1").props.onChange({ target: { value: "Offline thought" } });
    tree = community.render();
    find(tree, element => element.props.className === "quick-reply").props.onSubmit({ preventDefault: vi.fn() });
    expect(community.props.onToggleLike).not.toHaveBeenCalled();
    expect(community.props.onCreateComment).not.toHaveBeenCalled();
    expect(find(community.render(), element => element.props.id === "quick-reply-1").props.value).toBe("Offline thought");
  });
});
