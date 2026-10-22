import { describe, expect, it } from "vitest";
import { createWorkspaceContinuity, OFFLINE_ACCESS_GRACE_MS } from "./workspaceContinuity";

describe("temporary offline continuity", () => {
  it("requires a fresh server confirmation and never treats a cached token as membership", () => {
    const access = createWorkspaceContinuity(() => 1000);
    access.identify("member", 10000);
    expect(access.canKeepLoaded()).toBe(false);
    access.confirm(); expect(access.canKeepLoaded()).toBe(true);
    access.fail(); expect(access.canKeepLoaded()).toBe(true);
    expect(access.canWrite(true)).toBe(false);
    access.confirm(); expect(access.canWrite(true)).toBe(true);
    expect(access.canWrite(false)).toBe(false);
  });
  it("expires at the earlier of access grace and session expiry without extending on token refresh", () => {
    let time = 1000;
    const access = createWorkspaceContinuity(() => time);
    access.identify("member", 100000); access.confirm(); access.fail();
    time += OFFLINE_ACCESS_GRACE_MS;
    access.identify("member", 200000);
    expect(access.canKeepLoaded()).toBe(false);
    access.confirm(); access.identify("member", time / 1000 + 1);
    time += 1000; expect(access.canKeepLoaded()).toBe(false);
  });
  it("immediately invalidates old-account access, signout and confirmed revocation", () => {
    const access = createWorkspaceContinuity(() => 1000);
    access.identify("one", 100000); access.confirm();
    access.identify("two", 100000); expect(access.canKeepLoaded()).toBe(false);
    access.confirm(); access.revoke(); expect(access.canKeepLoaded()).toBe(false);
    access.confirm(); access.identify(null); expect(access.canKeepLoaded()).toBe(false);
  });
  it("cannot retain an expired or unknown session", () => {
    const access = createWorkspaceContinuity(() => 1000);
    access.identify("one"); access.confirm(); expect(access.canKeepLoaded()).toBe(false);
    access.identify("one", 1); access.confirm(); expect(access.canKeepLoaded()).toBe(false);
  });
});
