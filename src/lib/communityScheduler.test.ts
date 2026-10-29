import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const state = { tables: {} as Record<string, unknown>, tableErrors: {} as Record<string, unknown>, status: { databaseEnabled: false, workerActivationVerified: false, deliveryActivationVerified: false } as unknown, response: null as unknown, rpcError: null as unknown, sessionUserId: "10000000-0000-4000-8000-000000000099", switchOnRpc: false, user: { id: "10000000-0000-4000-8000-000000000099" } as { id: string } | null };
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; columns?: string; limit?: number }> = [];
  const from = vi.fn((table: string) => {
    const queryState = { table, filters: [] as Array<[string, unknown]>, columns: "", limit: 0 }; queries.push(queryState);
    const query: any = {};
    query.select = vi.fn((columns: string) => { queryState.columns = columns; return query; });
    query.eq = vi.fn((key: string, value: unknown) => { queryState.filters.push([key, value]); return query; });
    query.order = vi.fn(() => query); query.limit = vi.fn((limit: number) => { queryState.limit = limit; return query; }); query.single = vi.fn(() => query);
    query.then = (resolve: any, reject: any) => Promise.resolve({ data: state.tables[table] ?? [], error: state.tableErrors[table] ?? null }).then(resolve, reject);
    return query;
  });
  const headers: Array<[string,string]> = [];
  const rpc = vi.fn((name: string, _args?: unknown) => {
    if (state.switchOnRpc) state.sessionUserId = "10000000-0000-4000-8000-000000000088";
    const result: any = { setHeader: vi.fn((key: string, value: string) => { headers.push([key, value]); return result; }), then: (resolve: any, reject: any) => Promise.resolve({ data: name === "get_academy_post_scheduler_status" ? state.status : state.response, error: state.rpcError }).then(resolve, reject) };
    return result;
  });
  const getUser = vi.fn(async () => ({ data: { user: state.user }, error: null }));
  const getSession = vi.fn(async () => ({ data: { session: { user: { id: state.sessionUserId }, access_token: "fixture-admin-token" } }, error: null }));
  return { state, queries, from, rpc, getUser, getSession, headers };
});
vi.mock("./backend", () => ({ supabase: { from: fixture.from, rpc: fixture.rpc, auth: { getUser: fixture.getUser, getSession: fixture.getSession } } }));
import { loadCommunityScheduleOverview, nextCommunityScheduleOccurrence, parseCommunitySchedule, parseCommunityScheduleOccurrence, saveCommunitySchedule, scheduleLocalInstant, scheduleOccurrenceReason, scheduleValidationMessage, setCommunityScheduleState, validScheduleDate, type CommunityScheduleDraft } from "./communityScheduler";

const adminUser = "10000000-0000-4000-8000-000000000099";
const community = "10000000-0000-4000-8000-000000000001";
const author = "10000000-0000-4000-8000-000000000002";
const category = "10000000-0000-4000-8000-000000000003";
const scheduleId = "10000000-0000-4000-8000-000000000004";
const occurrenceId = "10000000-0000-4000-8000-000000000005";
const row = () => ({ id: scheduleId, client_request_id: scheduleId, created_by: "10000000-0000-4000-8000-000000000099", academy_community_id: community, author_member_id: author, category_id: category, title: "Monday tip", body: "Share one takeaway from your Academy lesson.", kind: "weekly", time_zone: "America/Phoenix", starts_on: "2026-10-26", ends_on: null, local_time: "09:00:00", weekdays: [1, 3, 5], state: "draft", catchup_minutes: 15, revision: 1, is_announcement: false, created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z" });
function draft(): CommunityScheduleDraft { const value = parseCommunitySchedule(row()); const { id: _id, ...rest } = value; return rest; }

beforeEach(() => {
  vi.clearAllMocks(); fixture.queries.length = 0; fixture.headers.length = 0; fixture.state.sessionUserId = adminUser; fixture.state.switchOnRpc = false;
  fixture.state.tables = { academy_members: { id: author, display_name: "Steve", role: "owner", status: "active" }, academy_post_schedules: [row()], academy_post_schedule_occurrences: [] };
  fixture.state.tableErrors = {}; fixture.state.status = { databaseEnabled: false, workerActivationVerified: false, deliveryActivationVerified: false }; fixture.state.response = row(); fixture.state.rpcError = null; fixture.state.user = { id: "10000000-0000-4000-8000-000000000099" };
});

describe("scheduled publishing client boundaries", () => {
  it("loads only the authenticated administrator and community-scoped schedules/history", async () => {
    const result = await loadCommunityScheduleOverview(community);
    expect(result.author).toEqual({ id: author, displayName: "Steve" });
    expect(result.schedules[0].localTime).toBe("09:00"); expect(result.status.databaseEnabled).toBe(false);
    expect(fixture.queries[0].filters).toEqual([["academy_community_id", community], ["user_id", fixture.state.user!.id]]);
    expect(fixture.queries.slice(1).every(query => query.filters.some(([key, value]) => key === "academy_community_id" && value === community))).toBe(true);
    expect(fixture.queries[1].limit).toBe(200); expect(fixture.queries[2].limit).toBe(100);
    expect(fixture.rpc).toHaveBeenCalledWith("get_academy_post_scheduler_status", { p_community_id: community });
  });
  it("fails closed for signed-out members, peers and inactive administrators", async () => {
    fixture.state.user = null; await expect(loadCommunityScheduleOverview(community)).rejects.toThrow("Sign in"); expect(fixture.from).not.toHaveBeenCalled();
    fixture.state.user = { id: author };
    for (const patch of [{ role: "member" }, { role: "moderator" }, { status: "suspended" }]) {
      fixture.state.tables.academy_members = { id: author, display_name: "Steve", role: "owner", status: "active", ...patch };
      await expect(loadCommunityScheduleOverview(community)).rejects.toThrow("administrator");
    }
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("explains missing migrations and refuses wrong-community or incomplete data", async () => {
    fixture.state.tableErrors.academy_post_schedules = { code: "PGRST205" };
    await expect(loadCommunityScheduleOverview(community)).rejects.toThrow("database update");
    fixture.state.tableErrors = {}; fixture.state.tables.academy_post_schedules = [{ ...row(), academy_community_id: category }];
    await expect(loadCommunityScheduleOverview(community)).rejects.toThrow("different Academy");
    fixture.state.tables.academy_post_schedules = [row()]; fixture.state.status = { databaseEnabled: true };
    await expect(loadCommunityScheduleOverview(community)).rejects.toThrow("could not be verified");
  });
  it("creates drafts even when a caller supplies active state and sends only approved fields", async () => {
    await saveCommunitySchedule({ ...draft(), state: "active", title: "  Monday tip  ", body: "  Share your lesson.  " }, adminUser);
    expect(fixture.rpc).toHaveBeenCalledWith("save_academy_post_schedule", { p_schedule: { clientRequestId: scheduleId, communityId: community, authorMemberId: author, categoryId: category, title: "Monday tip", body: "Share your lesson.", kind: "weekly", timeZone: "America/Phoenix", startsOn: "2026-10-26", endsOn: null, localTime: "09:00", weekdays: [1, 3, 5], state: "draft", catchupMinutes: 15 } });
  });
  it("requires a revision for edits and refuses invalid fields before RPC", async () => {
    for (const patch of [{ id: scheduleId, expectedRevision: undefined }, { weekdays: [1, 1] }, { localTime: "09:00:01" }, { title: "x" }, { body: "x" }, { timeZone: "Invented/Zone" }, { startsOn: "2026-02-30" }, { endsOn: "2026-10-01" }, { catchupMinutes: 0 }]) await expect(saveCommunitySchedule({ ...draft(), ...patch }, adminUser)).rejects.toThrow();
    expect(fixture.rpc).not.toHaveBeenCalled();
    await saveCommunitySchedule({ ...draft(), id: scheduleId, expectedRevision: 1 }, adminUser);
    expect(fixture.rpc.mock.calls[0]).toEqual(["save_academy_post_schedule", expect.objectContaining({ p_schedule: expect.objectContaining({ id: scheduleId, expectedRevision: 1 }) })]);
  });
  it("never labels an uncertain or conflicting write as saved", async () => {
    fixture.state.rpcError = { code: "40001" };
    await expect(saveCommunitySchedule(draft(), adminUser)).rejects.toThrow("another session");
    fixture.state.rpcError = { code: "23514", message: "private server details" };
    await expect(saveCommunitySchedule(draft(), adminUser)).rejects.toThrow("could not be confirmed");
    fixture.state.rpcError = null; fixture.state.response = { ...row(), academy_community_id: category };
    await expect(saveCommunitySchedule(draft(), adminUser)).rejects.toThrow("could not be verified");
  });
  it("uses optimistic concurrency for pause/cancel and cannot reactivate cancelled schedules", async () => {
    const schedule = parseCommunitySchedule(row()); fixture.state.response = { ...row(), revision: 2, state: "paused" };
    expect((await setCommunityScheduleState(schedule, "paused", adminUser)).state).toBe("paused");
    expect(fixture.rpc).toHaveBeenCalledWith("set_academy_post_schedule_state", { p_schedule_id: scheduleId, p_state: "paused", p_expected_revision: 1 });
    await expect(setCommunityScheduleState({ ...schedule, state: "cancelled" }, "active", adminUser)).rejects.toThrow("Refresh");
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects account switches before a mutation and binds the captured token if the SDK switches during RPC construction", async () => {
    fixture.state.sessionUserId = category;
    await expect(saveCommunitySchedule(draft(), adminUser)).rejects.toThrow("account changed");
    await expect(setCommunityScheduleState(parseCommunitySchedule(row()), "paused", adminUser)).rejects.toThrow("account changed");
    expect(fixture.rpc).not.toHaveBeenCalled();
    fixture.state.sessionUserId = adminUser; fixture.state.switchOnRpc = true;
    await saveCommunitySchedule(draft(), adminUser);
    expect(fixture.state.sessionUserId).not.toBe(adminUser);
    expect(fixture.headers).toEqual([["Authorization", "Bearer fixture-admin-token"]]);
  });
  it("preserves one create retry identifier through an uncertain response", async () => {
    const input = draft(); fixture.state.rpcError = { code: "NETWORK_FAILURE" };
    await expect(saveCommunitySchedule(input, adminUser)).rejects.toThrow("could not be confirmed");
    fixture.state.rpcError = null;
    expect((await saveCommunitySchedule(input, adminUser)).id).toBe(scheduleId);
    expect(fixture.rpc.mock.calls.map(call => (call[1] as any).p_schedule.clientRequestId)).toEqual([scheduleId, scheduleId]);
    fixture.state.response = { ...row(), client_request_id: category };
    await expect(saveCommunitySchedule(input, adminUser)).rejects.toThrow("could not be verified");
  });
  it("rejects malformed server states, revisions and publishing history", () => {
    for (const patch of [{ id: "invented" }, { revision: 0 }, { state: "ready" }, { weekdays: "Monday" }, { time_zone: "invented" }, { created_at: "tomorrow" }]) expect(() => parseCommunitySchedule({ ...row(), ...patch })).toThrow();
    const history = { id: occurrenceId, schedule_id: scheduleId, academy_community_id: community, scheduled_for: "2026-10-26T16:00:00Z", state: "skipped", post_id: null, reason_code: "catchup_expired", schedule_revision: 1, approved_snapshot: row() };
    expect(parseCommunityScheduleOccurrence(history).state).toBe("skipped");
    for (const patch of [{ state: "delivered" }, { scheduled_for: "yesterday" }, { post_id: "invented" }, { schedule_revision: -1 }]) expect(() => parseCommunityScheduleOccurrence({ ...history, ...patch })).toThrow();
    expect(scheduleOccurrenceReason("unrecognized_private_detail")).toBe("This occurrence needs administrator review.");
  });
  it("preserves immutable publication history when the published post has since been deleted", () => {
    const history = { id: occurrenceId, schedule_id: scheduleId, academy_community_id: community, scheduled_for: "2026-10-26T16:00:00Z", state: "published", post_id: null, reason_code: null, schedule_revision: 1, approved_snapshot: row() };
    expect(parseCommunityScheduleOccurrence(history)).toMatchObject({ state: "published", postId: null, snapshot: { title: "Monday tip", timeZone: "America/Phoenix" } });
  });
});

describe("schedule dates and time zones", () => {
  it("validates calendar dates and recurrence independently of this computer’s time zone", () => {
    expect(validScheduleDate("2028-02-29")).toBe(true); expect(validScheduleDate("2027-02-29")).toBe(false); expect(validScheduleDate("2026-2-01")).toBe(false);
    expect(scheduleValidationMessage({ ...draft(), kind: "once", weekdays: [] })).toBeNull();
    expect(scheduleValidationMessage({ ...draft(), kind: "once" })).toContain("one-time");
    expect(scheduleValidationMessage({ ...draft(), weekdays: [] })).toContain("weekday");
    expect(scheduleLocalInstant("2026-10-26", "09:00", "America/Phoenix")?.toISOString()).toBe("2026-10-26T16:00:00.000Z");
    expect(scheduleLocalInstant("2026-10-26", "09:00", "Asia/Kathmandu")?.toISOString()).toBe("2026-10-26T03:15:00.000Z");
  });
  it("skips nonexistent daylight-saving times and chooses the later fall-back instant", () => {
    expect(scheduleLocalInstant("2027-03-14", "02:30", "America/New_York")).toBeNull();
    expect(scheduleLocalInstant("2026-11-01", "01:30", "America/New_York")?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(scheduleLocalInstant("2026-10-04", "02:15", "Australia/Lord_Howe")).toBeNull();
    expect(scheduleLocalInstant("2011-12-30", "09:00", "Pacific/Apia")).toBeNull();
  });
  it("finds the next selected weekday within inclusive start/end dates", () => {
    const value = draft();
    expect(nextCommunityScheduleOccurrence(value, new Date("2026-10-26T16:00:01Z"))?.toISOString()).toBe("2026-10-28T16:00:00.000Z");
    expect(nextCommunityScheduleOccurrence({ ...value, endsOn: "2026-10-27" }, new Date("2026-10-26T16:00:01Z"))).toBeNull();
    expect(nextCommunityScheduleOccurrence({ ...value, startsOn: "2026-12-01", weekdays: [1] }, new Date("2026-10-24T00:00:00Z"))?.toISOString()).toBe("2026-12-07T16:00:00.000Z");
  });
  it("does not preview past one-time dates as future and skips weekly clock-change gaps", () => {
    const once = { ...draft(), kind: "once" as const, weekdays: [] };
    expect(nextCommunityScheduleOccurrence(once, new Date("2026-10-27T00:00:00Z"))).toBeNull();
    const weekly = { ...draft(), timeZone: "America/New_York", startsOn: "2027-03-01", weekdays: [7], localTime: "02:30" };
    expect(nextCommunityScheduleOccurrence(weekly, new Date("2027-03-13T00:00:00Z"))?.toISOString()).toBe("2027-03-21T06:30:00.000Z");
  });
});
