import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Query = { table: string; equals: [string, unknown][]; likes: [string, string][]; ors: string[]; limit?: number };
const mocks = vi.hoisted(() => {
  const queries: Query[] = [];
  const responses: Record<string, { data: unknown; error?: Error | null }[]> = {};
  const state = { userId: "user-a" as string | null, member: { id: "member-a", academy_community_id: "community-a" } as { id: string; academy_community_id: string } | null };
  const result = (table: string) => Promise.resolve(responses[table]?.shift() ?? { data: table === "academy_members" ? state.member : [], error: null });
  const client = {
    auth: { getSession: vi.fn(async () => ({ data: { session: state.userId ? { user: { id: state.userId } } : null }, error: null })) },
    from: vi.fn((table: string) => {
      const query: Query = { table, equals: [], likes: [], ors: [] }; queries.push(query);
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => { query.equals.push([column, value]); return builder; }),
        ilike: vi.fn((column: string, value: string) => { query.likes.push([column, value]); return builder; }),
        in: vi.fn(() => builder),
        order: vi.fn(() => builder),
        or: vi.fn((value: string) => { query.ors.push(value); return builder; }),
        limit: vi.fn((value: number) => { query.limit = value; return builder; }),
        maybeSingle: vi.fn(() => result(table)),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => result(table).then(resolve, reject),
      };
      return builder;
    }),
    storage: { from: vi.fn(() => ({ createSignedUrls: vi.fn(async () => ({ data: [], error: null })) })) },
  };
  return { state, client, queries, responses };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => mocks.client }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

let loadThread: typeof import("./backend").loadCommunityThread;
let search: typeof import("./backend").searchCommunityPosts;
const postId = "00000000-0000-4000-8000-000000000051";
const commentId = "00000000-0000-4000-8000-000000000060";
const row = (id = postId) => ({ id, academy_community_id: "community-a", title: "Old discussion", body: "Turf cleaning details", author_name: "Operator", academy_author_id: "member-other", reply_count: 1, created_at: "2026-01-01T12:00:00Z", category_name: "General", media: [], is_pinned: false, like_count: 2 });
beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  ({ loadCommunityThread: loadThread, searchCommunityPosts: search } = await import("./backend"));
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.queries.length = 0;
  for (const key of Object.keys(mocks.responses)) delete mocks.responses[key];
  mocks.state.userId = "user-a"; mocks.state.member = { id: "member-a", academy_community_id: "community-a" };
});

describe("authorized content recovery boundaries", () => {
  it("rejects malformed exact IDs before reading a session or constructing filters", async () => {
    expect(await loadThread("id.eq.other,academy_community_id.not.is.null")).toBeNull();
    expect(mocks.client.auth.getSession).not.toHaveBeenCalled();
    expect(mocks.client.from).not.toHaveBeenCalled();
  });

  it("does not read any content for a signed-out or inactive member", async () => {
    mocks.state.userId = null;
    expect(await loadThread(postId)).toBeNull();
    expect(await search("cleaning")).toEqual([]);
    expect(mocks.client.from).not.toHaveBeenCalled();
    mocks.state.userId = "user-a"; mocks.state.member = null;
    expect(await loadThread(postId)).toBeNull();
    expect(mocks.queries.every(query => query.table === "academy_members")).toBe(true);
    expect(mocks.queries[0].equals).toEqual([["user_id", "user-a"], ["status", "active"]]);
  });

  it("loads an exact authorized post and only its replies without touching feed pagination", async () => {
    mocks.responses.community_feed = [{ data: row() }];
    mocks.responses.academy_comment_feed = [{ data: [{ id: commentId, post_id: postId, parent_id: null, author_name: "Operator", academy_author_id: "member-other", body: "Reply", created_at: "2026-01-01T12:01:00Z", like_count: 0, is_answer: false, media: [] }] }];
    const thread = await loadThread(postId);
    expect(thread?.post.cloudId).toBe(postId);
    expect(thread?.comments[0].postCloudId).toBe(postId);
    expect(thread?.comments[0].postId).toBe(thread?.post.id);
    const postQuery = mocks.queries.find(query => query.table === "community_feed")!;
    expect(postQuery.equals).toEqual([["academy_community_id", "community-a"], ["id", postId]]);
    expect(postQuery.limit).toBeUndefined();
    expect(postQuery.ors).toEqual([]);
    const commentQuery = mocks.queries.find(query => query.table === "academy_comment_feed")!;
    expect(commentQuery.equals).toEqual([["academy_community_id", "community-a"], ["post_id", postId]]);
    for (const query of mocks.queries.filter(query => ["academy_post_reactions", "academy_post_bookmarks", "academy_comment_reactions"].includes(query.table))) {
      expect(query.equals).toContainEqual(["academy_member_id", "member-a"]);
    }
  });

  it("distinguishes an unavailable exact post from a query failure", async () => {
    mocks.responses.community_feed = [{ data: null }, { data: null, error: new Error("Connection failed") }];
    expect(await loadThread(postId)).toBeNull();
    expect(mocks.queries.some(query => query.table === "academy_comment_feed")).toBe(false);
    await expect(loadThread(postId)).rejects.toThrow("Connection failed");
  });

  it("searches scoped literal text, escapes wildcards, and avoids user input in OR grammar", async () => {
    const input = "50%_\\,title.eq.private";
    await search(input);
    const searches = mocks.queries.filter(query => query.table === "community_feed");
    expect(searches.length).toBeGreaterThanOrEqual(2);
    for (const query of searches) {
      expect(query.equals).toEqual([["academy_community_id", "community-a"]]);
      expect(query.ors).toEqual([]);
      expect(query.likes[0][1]).toBe("%50\\%\\_\\\\,title.eq.private%");
      expect(query.limit).toBe(30);
    }
  });

  it("deduplicates matches from separate search columns and preserves reaction context", async () => {
    mocks.responses.community_feed = [{ data: [row()] }, { data: [row()] }];
    mocks.responses.academy_post_reactions = [{ data: [{ post_id: postId }] }];
    mocks.responses.academy_post_bookmarks = [{ data: [{ post_id: postId }] }];
    const matches = await search("cleaning");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ cloudId: postId, liked: true, saved: true });
  });

  it("fails a remote search rather than presenting one failed column as complete", async () => {
    mocks.responses.community_feed = [{ data: [row()] }, { data: null, error: new Error("Read failed") }];
    await expect(search("cleaning")).rejects.toThrow("Read failed");
  });

  it("bounds search terms and skips blank or single-character reads", async () => {
    expect(await search(" ")).toEqual([]); expect(await search("x")).toEqual([]);
    expect(mocks.client.from).not.toHaveBeenCalled();
    await search("a".repeat(160));
    expect(mocks.queries.find(query => query.likes.length)?.likes[0][1]).toHaveLength(122);
  });
});
