import { describe, expect, it, vi } from "vitest";
import type { CommunityPost } from "../domain";
import type { CommunityPostCursor } from "./backend";
import { communityHasActiveDraft, createCommunityRefresh, loadCommunityPostWindow, mergeCommunityPostWindow } from "./communityRefresh";

function post(id: number): CommunityPost {
  return { id, cloudId: String(id), name: `Post ${id}`, author: "Member", body: "Body", replies: 0, age: "Today" };
}
const cursor = (id: number): CommunityPostCursor => ({ id: String(id), createdAt: new Date(id * 1000).toISOString() });
function pages(ids: number[], pageSize = 2) {
  return vi.fn(async (after?: CommunityPostCursor) => {
    const remaining = ids.filter(id => !after || id * 1000 < Date.parse(after.createdAt));
    const current = remaining.slice(0, pageSize);
    return { posts: current.map(post), hasMore: remaining.length > pageSize, nextCursor: current.length ? cursor(current.at(-1)!) : undefined };
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe("community loaded-window refresh", () => {
  it("includes new posts and updates/removes existing rows without dropping loaded older pages", async () => {
    const load = pages([7, 6, 5, 3, 2, 1]); // Post 4 was removed; 7 and 6 are new.
    const fresh = await loadCommunityPostWindow(load, cursor(2));
    expect(load).toHaveBeenCalledTimes(3);
    expect(fresh.complete).toBe(true);
    expect(mergeCommunityPostWindow([5, 4, 3, 2].map(post), fresh).map(item => item.id)).toEqual([7, 6, 5, 3, 2, 1]);
    expect(fresh.hasMore).toBe(false);
  });

  it("does not reload the entire feed for someone who has only loaded its first page", async () => {
    const load = pages([5, 4, 3, 2, 1]);
    const fresh = await loadCommunityPostWindow(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(fresh.posts.map(item => item.id)).toEqual([5, 4]);
    expect(fresh.hasMore).toBe(true);
  });

  it("bounds larger backlogs to five pages and retains the user's older rows without duplicates", async () => {
    const load = pages(Array.from({ length: 20 }, (_, index) => 20 - index));
    const fresh = await loadCommunityPostWindow(load, cursor(2));
    expect(load).toHaveBeenCalledTimes(5);
    expect(fresh.complete).toBe(false);
    const merged = mergeCommunityPostWindow([15, 14, 3, 2].map(post), fresh);
    expect(merged.map(item => item.id)).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 3, 2]);
  });

  it("rejects nonadvancing pagination instead of replacing a feed with an incomplete read", async () => {
    const load = vi.fn(async () => ({ posts: [post(5)], hasMore: true, nextCursor: cursor(5) }));
    await expect(loadCommunityPostWindow(load, cursor(1))).rejects.toThrow("did not advance");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses ID ordering when posts share a timestamp", async () => {
    const boundary = { ...cursor(3), id: "b" };
    const load = vi.fn().mockResolvedValueOnce({ posts: [post(3)], hasMore: true, nextCursor: { ...boundary, id: "c" } })
      .mockResolvedValueOnce({ posts: [post(2)], hasMore: true, nextCursor: { ...boundary, id: "a" } });
    const fresh = await loadCommunityPostWindow(load, boundary);
    expect(load).toHaveBeenCalledTimes(2);
    expect(fresh.complete).toBe(true);
  });
});

describe("community refresh races and cadence", () => {
  it("coalesces concurrent focus/resume calls and throttles completed bursts", async () => {
    let now = 0;
    const read = deferred<string[]>();
    const load = vi.fn(() => read.promise);
    const apply = vi.fn();
    const refresh = createCommunityRefresh({ load, apply, eligible: () => true, version: () => 0, now: () => now });
    const first = refresh.refresh();
    await refresh.refresh();
    now = 20_000;
    await refresh.refresh(); // Still pending, even though the throttle elapsed.
    expect(load).toHaveBeenCalledTimes(1);
    read.resolve(["Fresh"]);
    await first;
    await refresh.refresh();
    await refresh.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it.each(["member write", "account switch", "load more", "full reload"])("discards a response after %s", async () => {
    let revision = 0;
    const read = deferred<string[]>();
    const apply = vi.fn();
    const refresh = createCommunityRefresh({ load: () => read.promise, apply, eligible: () => true, version: () => revision });
    const pending = refresh.refresh();
    revision += 1;
    read.resolve(["Obsolete rows"]);
    await pending;
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps loaded content on failure, retries, and never applies after disposal", async () => {
    let now = 0;
    const read = deferred<string[]>();
    const load = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockImplementationOnce(() => read.promise);
    const apply = vi.fn();
    const onError = vi.fn();
    const refresh = createCommunityRefresh({ load, apply, onError, eligible: () => true, version: () => 0, now: () => now });
    await refresh.refresh();
    expect(onError).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    now = 60_000;
    const retry = refresh.refresh();
    refresh.dispose();
    read.resolve(["Fresh"]);
    await retry;
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not fetch while a draft is active, and discards a read if drafting begins during it", async () => {
    let eligible = false;
    const read = deferred<string[]>();
    const load = vi.fn(() => read.promise);
    const apply = vi.fn();
    const refresh = createCommunityRefresh({ load, apply, eligible: () => eligible, version: () => 0 });
    await refresh.refresh();
    expect(load).not.toHaveBeenCalled();
    eligible = true;
    const pending = refresh.refresh();
    eligible = false;
    read.resolve(["Fresh"]);
    await pending;
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("draft preservation", () => {
  it.each(["composer", "reply target", "quick reply", "thread reply"])("pauses for an active %s", mode => {
    const document = {
      querySelector: () => ["composer", "reply target"].includes(mode) ? {} : null,
      querySelectorAll: () => [{ value: "Draft reply" }],
    } as unknown as Document;
    expect(communityHasActiveDraft(document)).toBe(true);
  });
  it("allows refresh when reply fields are empty", () => {
    const document = { querySelector: () => null, querySelectorAll: () => [{ value: "" }] } as unknown as Document;
    expect(communityHasActiveDraft(document)).toBe(false);
  });
});
