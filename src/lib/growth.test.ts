import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const state = { access: {} as Record<string, unknown>, table: { data: null as unknown, error: null as null | { code: string } }, create: { data: null as unknown, error: null as null | { code: string } } };
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "order", "limit", "update", "upsert"]) query[name] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => state.table);
  query.single = vi.fn(async () => state.table);
  query.then = vi.fn((resolve: (value: unknown) => void, reject: (reason: unknown) => void) => Promise.resolve(state.table).then(resolve, reject));
  const rpc = vi.fn(async (name: string) => name === "get_academy_access_state" ? { data: state.access, error: null } : state.create);
  const from = vi.fn(() => query);
  return { state, query, rpc, from, getUser: vi.fn(async () => ({ data: { user: { id: "10000000-0000-4000-8000-000000000010" } }, error: null })) };
});
vi.mock("./backend", () => ({ supabase: { rpc: fixture.rpc, from: fixture.from, auth: { getUser: fixture.getUser } } }));
import { createGrowthRequest, defaultGrowthSettings, growthServices, loadAdminGrowthRequests, loadGrowthCatalog, loadOwnGrowthRequests, parseGrowthRequest, parseGrowthSettings, saveGrowthSettings, updateGrowthRequestStatus, validateGrowthSettings, type GrowthSettings } from "./growth";

const community = "10000000-0000-4000-8000-000000000001";
const otherCommunity = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const requestRow = { id: requestId, service_key: "website", status: "new", notes: "A new site", created_at: "2026-10-22T15:00:00Z", member_name: "Member", company_name: "Turf business" };
const settingsRow = () => ({ academy_community_id: community, service_cadences: defaultGrowthSettings(community).serviceCadences });

beforeEach(() => {
  vi.clearAllMocks();
  fixture.state.access = { hasAccess: true, communityId: community, canManage: false };
  fixture.state.table = { data: null, error: null };
  fixture.state.create = { data: { ...requestRow }, error: null };
});

describe("growth services and verified settings", () => {
  it("uses the supplied ranges and only the confirmed cadences", () => {
    expect(growthServices.map(({ key, fromCents, toCents, billingInterval }) => [key, fromCents, toCents, billingInterval])).toEqual([
      ["website",149500,249500,"one_time"], ["ghl",149500,249500,"one_time"], ["seo-aeo",149500,249500,"one_time"], ["facebook-ads",49500,89500,"month"], ["website-care",9700,9700,"month"], ["ghl-subscription",19700,19700,"month"],
    ]);
    expect(defaultGrowthSettings(community)).not.toHaveProperty("storeUrl");
  });
  it("only fills defaults after a successful authorized lookup with no settings row", async () => {
    const catalog = await loadGrowthCatalog();
    expect(catalog.settings).toEqual(defaultGrowthSettings(community));
    expect(fixture.query.eq).toHaveBeenCalledWith("academy_community_id", community);
    expect(catalog.services).toHaveLength(6);
  });
  it("rejects settings that recast an approved one-time price as monthly", async () => {
    const row = settingsRow(); row.service_cadences["seo-aeo"] = "month";
    fixture.state.table.data = row;
    await expect(loadGrowthCatalog()).rejects.toThrow("approved service payment schedules");
  });
  it("reports a missing migration instead of a configured or empty success", async () => {
    fixture.state.table = { data: null, error: { code: "PGRST205" } };
    await expect(loadGrowthCatalog()).rejects.toThrow("database update");
  });
  it("rejects access failures before reading any catalog or requests", async () => {
    for (const access of [{ hasAccess: false, communityId: community }, { hasAccess: true, communityId: "bad-id" }, {}]) {
      fixture.state.access = access;
      await expect(loadGrowthCatalog()).rejects.toThrow("Active Academy access");
    }
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("rejects foreign-community rows and incomplete or invented cadences", () => {
    expect(() => parseGrowthSettings({ ...settingsRow(), academy_community_id: otherCommunity }, community)).toThrow("do not belong");
    for (const serviceCadences of [{}, { ...settingsRow().service_cadences, other: "month" }, { ...settingsRow().service_cadences, website: "year" }]) {
      expect(() => validateGrowthSettings({ communityId: community, serviceCadences } as GrowthSettings)).toThrow();
    }
  });
  it("does not expose raw provider errors or private response details", async () => {
    fixture.state.table.error = { code: "unknown_provider_detail" };
    await expect(loadGrowthCatalog()).rejects.toThrow("Growth options could not load");
  });
});

describe("member service requests", () => {
  it("submits only service, bounded notes and retry ID, never client-supplied identity", async () => {
    expect(await createGrowthRequest("website", "  A new site  ", requestId)).toEqual(parseGrowthRequest(requestRow));
    expect(fixture.rpc).toHaveBeenCalledWith("create_academy_growth_request", { p_service_key: "website", p_notes: "A new site", p_request_id: requestId });
  });
  it("rejects invalid service, oversized notes and malformed id before access lookup", async () => {
    await expect(createGrowthRequest("other" as "website", "", requestId)).rejects.toThrow();
    await expect(createGrowthRequest("website", "x".repeat(2001), requestId)).rejects.toThrow();
    await expect(createGrowthRequest("website", "", "not-a-uuid")).rejects.toThrow();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("accepts a confirmed existing open or closed request without implying a new submission", async () => {
    fixture.state.create.data = { ...requestRow, status: "contacted" };
    expect(await createGrowthRequest("website", "different unsaved retry notes", requestId)).toEqual({ ...parseGrowthRequest(requestRow), status: "contacted" });
    fixture.state.create.data = { ...requestRow, status: "closed" };
    expect((await createGrowthRequest("website", "retry", requestId)).status).toBe("closed");
  });
  it("never claims successful persistence from an empty or malformed RPC reply", async () => {
    for (const data of [null, {}, { id: "bad", status: "new" }, { id: requestId, status: "sent" }]) {
      fixture.state.create.data = data;
      await expect(createGrowthRequest("website", "", requestId)).rejects.toThrow("could not be confirmed");
    }
  });
  it("surfaces missing request RPC as an actionable migration error", async () => {
    fixture.state.create = { data: null, error: { code: "PGRST202" } };
    await expect(createGrowthRequest("website", "", requestId)).rejects.toThrow("Academy growth services migration");
  });
  it("filters own requests by both current Academy and verified user ID, including for admins", async () => {
    fixture.state.access.canManage = true;
    fixture.state.table.data = [requestRow];
    expect(await loadOwnGrowthRequests()).toEqual([{ id: requestId, serviceKey: "website", status: "new", notes: "A new site", createdAt: requestRow.created_at, memberName: "Member", companyName: "Turf business" }]);
    expect(fixture.query.eq).toHaveBeenCalledWith("academy_community_id", community);
    expect(fixture.query.eq).toHaveBeenCalledWith("user_id", "10000000-0000-4000-8000-000000000010");
    expect(fixture.query.limit).toHaveBeenCalledWith(250);
  });
  it("rejects malformed stored requests", () => {
    for (const row of [{ ...requestRow, status: "fake" }, { ...requestRow, notes: "x".repeat(2001) }, { ...requestRow, created_at: "bad" }, { ...requestRow, id: "bad" }]) expect(() => parseGrowthRequest(row)).toThrow();
  });
});

describe("admin request and service settings boundaries", () => {
  it("rejects non-admin and foreign-community request reads", async () => {
    await expect(loadAdminGrowthRequests(community)).rejects.toThrow("Administrator");
    fixture.state.access.canManage = true;
    await expect(loadAdminGrowthRequests(otherCommunity)).rejects.toThrow("Administrator");
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("reads only the verified current Academy for an administrator", async () => {
    fixture.state.access.canManage = true; fixture.state.table.data = [requestRow];
    expect(await loadAdminGrowthRequests(community)).toHaveLength(1);
    expect(fixture.query.eq).toHaveBeenCalledWith("academy_community_id", community);
    expect(fixture.query.eq).toHaveBeenCalledWith("status", "new");
    expect(fixture.query.eq).toHaveBeenCalledWith("status", "contacted");
    expect(fixture.query.eq).toHaveBeenCalledWith("status", "closed");
    expect(fixture.from).toHaveBeenCalledTimes(3);
  });
  it("filters requested admin status on the server before applying the row bound", async () => {
    fixture.state.access.canManage = true; fixture.state.table.data = [requestRow];
    expect(await loadAdminGrowthRequests(community, "new")).toHaveLength(1);
    expect(fixture.query.eq).toHaveBeenCalledWith("status", "new");
    expect(fixture.query.eq).not.toHaveBeenCalledWith("status", "closed");
    expect(fixture.from).toHaveBeenCalledOnce();
    await expect(loadAdminGrowthRequests(community, "invented" as "new")).rejects.toThrow("valid request status");
  });
  it("updates only request status and requires a confirmed affected row", async () => {
    fixture.state.access.canManage = true; fixture.state.table.data = { id: requestId };
    await updateGrowthRequestStatus(requestId, "contacted");
    expect(fixture.query.update).toHaveBeenCalledWith({ status: "contacted" });
    expect(fixture.query.eq).toHaveBeenCalledWith("academy_community_id", community);
    fixture.state.table.data = null;
    await expect(updateGrowthRequestStatus(requestId, "closed")).rejects.toThrow("could not be saved");
  });
  it("does not allow ordinary members to save settings or update requests", async () => {
    await expect(saveGrowthSettings(defaultGrowthSettings(community))).rejects.toThrow("Administrator");
    await expect(updateGrowthRequestStatus(requestId, "closed")).rejects.toThrow("Administrator");
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("saves only confirmed service cadences for the verified Academy", async () => {
    fixture.state.access.canManage = true; fixture.state.table.data = settingsRow();
    expect(await saveGrowthSettings(defaultGrowthSettings(community))).toEqual(defaultGrowthSettings(community));
    expect(fixture.query.upsert).toHaveBeenCalledWith({ academy_community_id: community, service_cadences: settingsRow().service_cadences }, { onConflict: "academy_community_id" });
    await expect(saveGrowthSettings(defaultGrowthSettings(otherCommunity))).rejects.toThrow("Administrator");
  });
  it("rejects changed monthly add-on cadence before touching the database", async () => {
    fixture.state.access.canManage = true;
    const altered = defaultGrowthSettings(community); altered.serviceCadences["website-care"] = "one_time";
    await expect(saveGrowthSettings(altered)).rejects.toThrow("approved service payment schedules");
    expect(fixture.from).not.toHaveBeenCalled();
  });
});
