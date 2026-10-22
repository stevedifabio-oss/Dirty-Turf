import type { CommunityPost } from "../domain";
import type { CommunityPostCursor } from "./backend";

type PostPage = { posts: CommunityPost[]; hasMore: boolean; nextCursor?: CommunityPostCursor };
export type CommunityPostWindow = PostPage & { complete: boolean };

function reached(cursor: CommunityPostCursor, boundary: CommunityPostCursor) {
  const difference = Date.parse(cursor.createdAt) - Date.parse(boundary.createdAt);
  return difference < 0 || (difference === 0 && cursor.id <= boundary.id);
}

/** Read through the loaded window, including rows shifted by newly published posts.
 * Five pages bounds a refresh; a larger backlog keeps its existing older pages. */
export async function loadCommunityPostWindow(
  load: (cursor?: CommunityPostCursor) => Promise<PostPage>,
  boundary?: CommunityPostCursor,
): Promise<CommunityPostWindow> {
  const posts: CommunityPost[] = [];
  const seen = new Set<string | number>();
  let cursor: CommunityPostCursor | undefined;
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const page = await load(cursor);
    for (const post of page.posts) {
      const id = post.cloudId ?? post.id;
      if (!seen.has(id)) { posts.push(post); seen.add(id); }
    }
    if (page.hasMore && (!page.nextCursor || (cursor && !reached(page.nextCursor, cursor)) ||
        (cursor && page.nextCursor.id === cursor.id && page.nextCursor.createdAt === cursor.createdAt))) {
      throw new Error("Community pagination did not advance.");
    }
    const complete = !page.hasMore || !boundary || Boolean(page.nextCursor && reached(page.nextCursor, boundary));
    if (complete || pageNumber === 4) return { ...page, posts, complete };
    cursor = page.nextCursor;
  }
  throw new Error("Community pagination unavailable.");
}

export function mergeCommunityPostWindow(current: CommunityPost[], fresh: CommunityPostWindow): CommunityPost[] {
  if (fresh.complete) return fresh.posts;
  const ids = new Set(fresh.posts.map(post => post.cloudId ?? post.id));
  return [...fresh.posts, ...current.filter(post => !ids.has(post.cloudId ?? post.id))];
}

/** Retain database changes through bursts and guarded reads; never undo member writes. */
export function createCommunityRefresh<T>(options: {
  load: () => Promise<T>;
  apply: (value: T) => void;
  eligible: () => boolean;
  version: () => number;
  now?: () => number;
  onError?: () => void;
  onSuccess?: () => void;
}) {
  let disposed = false;
  let pending = false;
  let dirty = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStarted = -Infinity;
  const now = options.now ?? Date.now;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    if (disposed || pending || !dirty || timer !== undefined) return;
    const remaining = Math.max(0, 15_000 - (now() - lastStarted));
    // While drafting, playing media or loading pages, only recheck the guard.
    const delay = options.eligible() ? remaining : Math.max(remaining, 1_000);
    timer = setTimeout(() => { timer = undefined; void refresh(); }, delay);
  };
  const refresh = async () => {
    if (disposed || pending) return;
    if (!options.eligible() || now() - lastStarted < 15_000) { schedule(); return; }
    clearTimer();
    pending = true;
    lastStarted = now();
    const activeGeneration = generation;
    const version = options.version();
    const requestedByChange = dirty;
    dirty = false;
    try {
      const value = await options.load();
      if (disposed || generation !== activeGeneration) return;
      if (options.eligible() && options.version() === version) {
        options.apply(value);
        options.onSuccess?.();
      } else if (requestedByChange) dirty = true;
    } catch {
      if (!disposed && generation === activeGeneration) {
        if (requestedByChange) dirty = true;
        if (options.eligible() && options.version() === version) options.onError?.();
      }
    } finally {
      if (generation === activeGeneration) { pending = false; schedule(); }
    }
  };
  const reset = () => {
    generation += 1;
    pending = false;
    dirty = false;
    lastStarted = -Infinity;
    clearTimer();
  };
  return {
    refresh,
    invalidate: () => { if (!disposed) { dirty = true; void refresh(); } },
    reset,
    dispose: () => { disposed = true; reset(); },
  };
}

/** Let writers finish and keep a selected thread available while a reply is drafted. */
export function communityHasActiveDraft(document: Pick<Document, "querySelector" | "querySelectorAll">) {
  if (document.querySelector(".full-composer, .replying-to")) return true;
  return [...document.querySelectorAll<HTMLInputElement>(".quick-reply input, .reply-composer input")]
    .some(input => input.value.length > 0);
}
