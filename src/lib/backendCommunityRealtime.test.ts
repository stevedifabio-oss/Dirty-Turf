import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels: { name: string; handlers: { filter: { event: string; schema: string; table: string }; change: () => void }[]; status?: (status: string) => void }[] = [];
  const removeChannel = vi.fn();
  const client = {
    channel: vi.fn((name: string) => {
      const record: typeof channels[number] = { name, handlers: [] };
      channels.push(record);
      const channel = {
        on: (_type: string, filter: typeof record.handlers[number]["filter"], change: () => void) => {
          record.handlers.push({ filter, change }); return channel;
        },
        subscribe: (status: (status: string) => void) => { record.status = status; return channel; },
      };
      return channel;
    }),
    removeChannel,
  };
  return { channels, client, removeChannel };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => mocks.client }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

let subscribe: typeof import("./backend").subscribeToCommunityChanges;
beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  ({ subscribeToCommunityChanges: subscribe } = await import("./backend"));
});
beforeEach(() => { vi.clearAllMocks(); mocks.channels.length = 0; });

describe("Community database subscription", () => {
  it("invalidates on post/comment changes without duplicating notification subscriptions", () => {
    const changed = vi.fn();
    const dispose = subscribe(changed);
    expect(mocks.channels[0].handlers.map(item => item.filter)).toEqual([
      { event: "*", schema: "public", table: "community_posts" },
      { event: "*", schema: "public", table: "community_comments" },
    ]);
    mocks.channels[0].handlers.forEach(item => item.change());
    expect(changed).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("invalidates after initial connection and reconnection to recover missed changes", () => {
    const changed = vi.fn();
    const dispose = subscribe(changed);
    mocks.channels[0].status?.("SUBSCRIBED");
    mocks.channels[0].status?.("CHANNEL_ERROR");
    mocks.channels[0].status?.("SUBSCRIBED");
    expect(changed).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("isolates registrations and suppresses stale callbacks after account cleanup", () => {
    const oldChanged = vi.fn();
    const currentChanged = vi.fn();
    const stopOld = subscribe(oldChanged);
    const stopCurrent = subscribe(currentChanged);
    expect(mocks.channels[0].name).not.toBe(mocks.channels[1].name);
    stopOld(); stopOld();
    mocks.channels[0].handlers.forEach(item => item.change());
    mocks.channels[0].status?.("SUBSCRIBED");
    mocks.channels[1].handlers[0].change();
    expect(oldChanged).not.toHaveBeenCalled();
    expect(currentChanged).toHaveBeenCalledOnce();
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
    stopCurrent();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(2);
  });
});
