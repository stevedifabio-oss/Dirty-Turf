import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommunityRefresh } from "./communityRefresh";

const mocks = vi.hoisted(() => {
  const getSession = vi.fn();
  const commentPage = vi.fn();
  const reactions = vi.fn();
  const cursor = vi.fn();
  const order = vi.fn();
  const client = {
    auth: { getSession },
    from: vi.fn((table: string) => {
      if (table === "academy_members") {
        const query = { select: () => query, eq: () => query, limit: () => query,
          maybeSingle: async () => ({ data: { id: "member-1", academy_community_id: "community-1" }, error: null }) };
        return query;
      }
      if (table === "academy_comment_feed") {
        const query = { select: () => query, eq: () => query,
          order: (...args: unknown[]) => { order(...args); return query; },
          or: (value: string) => { cursor(value); return query; }, limit: commentPage };
        return query;
      }
      if (table === "academy_comment_reactions") {
        const query = { select: () => query, eq: () => query, in: reactions };
        return query;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return { client, getSession, commentPage, reactions, cursor, order };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => mocks.client }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const createdAt = "2026-10-03T12:00:00.123456+00:00";
const row = (number: number) => ({ id: id(number), post_id: id(99_999), parent_id: null,
  author_name: "Member", body: `Comment ${number}`, created_at: createdAt, like_count: 2,
  is_answer: false, academy_author_id: "member-1" });
let loadComments: typeof import("./backend").loadComments;

beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  ({ loadComments } = await import("./backend"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commentPage.mockReset();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });
  mocks.reactions.mockReset().mockImplementation(async (_column: string, ids: string[]) => ({
    data: ids.includes(id(503)) ? [{ comment_id: id(503) }] : [], error: null,
  }));
});

describe("complete community comment reads", () => {
  it("keeps comments newer than the first 500 and pages by timestamp plus ID", async () => {
    mocks.commentPage.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => row(index + 1)), error: null })
      .mockResolvedValueOnce({ data: [row(501), row(502), row(503)], error: null });

    const comments = await loadComments([]);

    expect(comments).toHaveLength(503);
    expect(comments.map(comment => comment.body)).toEqual(Array.from({ length: 503 }, (_, index) => `Comment ${index + 1}`));
    expect(comments.at(-1)).toMatchObject({ cloudId: id(503), liked: true, likes: 2 });
    expect(mocks.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(mocks.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(mocks.cursor).toHaveBeenCalledWith(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id(500)})`);
    expect(mocks.reactions.mock.calls.every(([, ids]) => ids.length <= 100)).toBe(true);
  });

  it("checks the next page when the last page is exactly full", async () => {
    mocks.commentPage.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => row(index + 1)), error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    expect(await loadComments([])).toHaveLength(500);
    expect(mocks.commentPage).toHaveBeenCalledTimes(2);
  });

  it("preserves existing UI comments when a later page fails", async () => {
    mocks.commentPage.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => row(index + 1)), error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("Page unavailable") });
    const apply = vi.fn();
    const onError = vi.fn();
    await createCommunityRefresh({ load: () => loadComments([]), apply, onError, eligible: () => true, version: () => 0 }).refresh();
    expect(apply).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("discards a multi-page read when the account changes before completion", async () => {
    let revision = 0;
    let completePage!: (value: { data: ReturnType<typeof row>[]; error: null }) => void;
    let startPage!: () => void;
    const secondStarted = new Promise<void>(resolve => { startPage = resolve; });
    const secondPage = new Promise<{ data: ReturnType<typeof row>[]; error: null }>(resolve => { completePage = resolve; });
    mocks.commentPage.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, index) => row(index + 1)), error: null })
      .mockImplementationOnce(() => { startPage(); return secondPage; });
    const apply = vi.fn();
    const refresh = createCommunityRefresh({ load: () => loadComments([]), apply, eligible: () => true, version: () => revision });
    const pending = refresh.refresh();
    await secondStarted;
    revision += 1;
    completePage({ data: [row(501)], error: null });
    await pending;
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects a reaction lookup failure rather than resetting liked state", async () => {
    mocks.commentPage.mockResolvedValue({ data: [row(1)], error: null });
    mocks.reactions.mockResolvedValueOnce({ data: null, error: new Error("Reactions unavailable") });
    await expect(loadComments([])).rejects.toThrow("Reactions unavailable");
  });

  it("rejects a repeated page instead of duplicating comments or looping", async () => {
    mocks.commentPage.mockResolvedValue({ data: Array.from({ length: 500 }, (_, index) => row(index + 1)), error: null });
    await expect(loadComments([])).rejects.toThrow("pagination did not advance");
  });

  it("fails at its safety limit rather than returning a truncated collection", async () => {
    let page = 0;
    mocks.commentPage.mockImplementation(async (size: number) => {
      const data = Array.from({ length: size }, (_, index) => row(page * size + index + 1));
      page += 1;
      return { data, error: null };
    });
    await expect(loadComments([])).rejects.toThrow("complete comment history");
    expect(mocks.commentPage).toHaveBeenCalledTimes(20);
  });
});
