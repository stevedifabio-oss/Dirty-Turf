import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Query = {
  table: string;
  operation: "read" | "insert" | "update";
  values?: Record<string, unknown>;
  selected?: string;
  filters: [string, unknown][];
  nullFilters: [string, unknown][];
};

const mocks = vi.hoisted(() => {
  const queries: Query[] = [];
  const state = {
    currentCourse: { published_at: "2026-09-20T12:00:00Z" } as { published_at: string | null } | null,
    readError: null as Error | null,
    writeError: null as Error | null,
    inviteResult: { processed: 2, failed: 0 } as unknown,
    inviteError: null as Error | null,
  };
  const result = (query: Query) => {
    if (query.table === "academy_communities") return { data: { id: "community-a", name: "Academy", owner_organization_id: "organization-a" }, error: null };
    if (query.table === "courses" && query.operation === "read") return { data: state.currentCourse, error: state.readError };
    if (query.operation !== "read") {
      // Model the restrictive RLS helper's statement snapshot: a new module
      // or lesson cannot be re-read inside that same INSERT's RETURNING.
      const visibilityError = query.operation === "insert" && query.table !== "courses" && query.selected
        ? new Error("new row violates row-level security policy") : null;
      return { data: query.selected ? { id: query.values?.id ?? query.filters.find(([column]) => column === "id")?.[1] ?? "course-a" } : null, error: state.writeError ?? visibilityError };
    }
    throw new Error(`Unexpected read after ${query.table} insertion`);
  };
  const client = {
    rpc: vi.fn(async () => ({ data: { canManage: true, communityId: "community-a" }, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: state.inviteResult, error: state.inviteError })) },
    from: vi.fn((table: string) => {
      const query: Query = { table, operation: "read", filters: [], nullFilters: [] };
      queries.push(query);
      const builder = {
        select: vi.fn((columns: string) => { query.selected = columns; return builder; }),
        insert: vi.fn((values: Record<string, unknown>) => { query.operation = "insert"; query.values = values; return builder; }),
        update: vi.fn((values: Record<string, unknown>) => { query.operation = "update"; query.values = values; return builder; }),
        eq: vi.fn((column: string, value: unknown) => { query.filters.push([column, value]); return builder; }),
        is: vi.fn((column: string, value: unknown) => { query.nullFilters.push([column, value]); return builder; }),
        single: vi.fn(async () => result(query)),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result(query)).then(resolve, reject),
      };
      return builder;
    }),
  };
  return { client, queries, state };
});

vi.mock("./backend", () => ({ supabase: mocks.client }));

import { MemberInvitePartialFailure, runMemberInviteAction, saveAdminCourse, saveAdminLesson, saveAdminModule } from "./adminBackend";

const generatedId = "00000000-0000-4000-8000-000000000001";
const now = "2026-10-21T20:00:00.000Z";
const writes = () => mocks.queries.filter(query => query.operation !== "read");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => generatedId) });
  mocks.queries.length = 0;
  mocks.state.currentCourse = { published_at: "2026-09-20T12:00:00Z" };
  mocks.state.readError = null;
  mocks.state.writeError = null;
  mocks.state.inviteResult = { processed: 2, failed: 0 };
  mocks.state.inviteError = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("course publication history", () => {
  it.each(["published", "draft", "archived"] as const)("preserves the server publication date when saving a %s course", async (status) => {
    expect(await saveAdminCourse({ id: "course-a", title: " Revised course ", status })).toBe("course-a");
    expect(writes()[0].values).not.toHaveProperty("published_at");
    expect(writes()[0].values).toMatchObject({ title: "Revised course", status });
    expect(mocks.queries.find(query => query.table === "courses" && query.operation === "read")?.filters)
      .toEqual([["id", "course-a"], ["academy_community_id", "community-a"]]);
    expect(writes()[0].filters).toEqual([["id", "course-a"], ["academy_community_id", "community-a"]]);
  });

  it("stamps the first publication and guards against a concurrent first publication", async () => {
    mocks.state.currentCourse = { published_at: null };
    await saveAdminCourse({ id: "course-a", title: "Course", status: "published" });
    expect(writes()[0].values).toMatchObject({ published_at: now, status: "published" });
    expect(writes()[0].nullFilters).toEqual([["published_at", null]]);
  });

  it("does not stamp an existing unpublished draft", async () => {
    mocks.state.currentCourse = { published_at: null };
    await saveAdminCourse({ id: "course-a", title: "Course", status: "draft" });
    expect(writes()[0].values).not.toHaveProperty("published_at");
  });

  it.each([["published", now], ["draft", null]] as const)("sets the correct initial date for a new %s course", async (status, publishedAt) => {
    await saveAdminCourse({ title: "New course", status });
    expect(writes()[0].values?.published_at).toBe(publishedAt);
    expect(mocks.queries.some(query => query.table === "courses" && query.operation === "read")).toBe(false);
  });

  it("does not write when the fresh server lookup is denied or missing", async () => {
    const failure = new Error("Course is unavailable");
    mocks.state.readError = failure;
    await expect(saveAdminCourse({ id: "course-other", title: "Course", status: "published" })).rejects.toBe(failure);
    expect(writes()).toEqual([]);
    mocks.state.readError = null;
    mocks.state.currentCourse = null;
    await expect(saveAdminCourse({ id: "course-other", title: "Course" })).rejects.toThrow("no longer available");
    expect(writes()).toEqual([]);
  });

  it("surfaces a conflicting publication without retrying over the server value", async () => {
    mocks.state.currentCourse = { published_at: null };
    mocks.state.writeError = new Error("The result contains 0 rows");
    await expect(saveAdminCourse({ id: "course-a", title: "Course", status: "published" })).rejects.toBe(mocks.state.writeError);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].nullFilters).toEqual([["published_at", null]]);
  });
});

describe("native module and lesson creation", () => {
  const cases = [
    { table: "course_modules", save: () => saveAdminModule({ courseId: "course-a", title: " First module " }) },
    { table: "course_lessons", save: () => saveAdminLesson({ moduleId: "module-a", title: " First lesson " }) },
  ];
  it.each(cases)("creates $table without INSERT RETURNING and returns its known ID without a fallible second read", async ({ table, save }) => {
    expect(await save()).toBe(generatedId);
    const relevant = mocks.queries.filter(query => query.table === table);
    expect(relevant).toHaveLength(1);
    expect(relevant[0]).toMatchObject({ operation: "insert", values: { id: generatedId } });
    expect(relevant[0].selected).toBeUndefined();
  });

  it.each(cases)("does not confirm $table after a failed insert", async ({ table, save }) => {
    mocks.state.writeError = new Error("Insert denied");
    await expect(save()).rejects.toBe(mocks.state.writeError);
    expect(mocks.queries.filter(query => query.table === table)).toHaveLength(1);
  });

  it("keeps edits on the existing row and does not generate a new ID", async () => {
    expect(await saveAdminModule({ id: "module-a", courseId: "course-a", title: "Module" })).toBe("module-a");
    expect(await saveAdminLesson({ id: "lesson-a", moduleId: "module-a", title: "Lesson", status: "published" })).toBe("lesson-a");
    expect(writes().map(query => [query.operation, query.filters, query.selected])).toEqual([
      ["update", [["id", "module-a"]], "id"],
      ["update", [["id", "lesson-a"]], "id"],
    ]);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
});

describe("member action outcomes", () => {
  it.each(["provision", "notify"] as const)("surfaces partial %s failure and retains the full server result", async (action) => {
    const response = { processed: 5, failed: 2, remainingForAction: 3, results: [{ status: "failed", reason: "Email unavailable" }] };
    mocks.state.inviteResult = response;
    const failure = await runMemberInviteAction(action).catch(error => error);
    expect(failure).toBeInstanceOf(MemberInvitePartialFailure);
    expect(failure.result).toBe(response);
    expect(failure.action).toBe(action);
    expect(failure.message).toContain("2 failures (5 processed)");
    expect(failure.message).toContain("Review member status before retrying");
  });

  it("preserves a successful response and the existing bounded batch request", async () => {
    const response = { processed: 2, failed: 0, remainingForAction: 1 };
    mocks.state.inviteResult = response;
    expect(await runMemberInviteAction("notify")).toBe(response);
    expect(mocks.client.functions.invoke).toHaveBeenCalledWith("academy-invite-members", { body: { academyCommunityId: "community-a", action: "notify", limit: 25 } });
  });

  it("preserves transport failures and rejects missing action results", async () => {
    mocks.state.inviteError = new Error("Function unavailable");
    await expect(runMemberInviteAction("provision")).rejects.toBe(mocks.state.inviteError);
    mocks.state.inviteError = null;
    mocks.state.inviteResult = null;
    await expect(runMemberInviteAction("notify")).rejects.toThrow("returned no result");
  });
});
