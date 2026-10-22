import { describe, expect, it } from "vitest";
import { createWorkspaceSession } from "./workspaceSession";

describe("workspace session lifecycle", () => {
  it("loads a restored session once and preserves it when the app resumes", () => {
    const session = createWorkspaceSession();
    expect(session.authChanged("INITIAL_SESSION", "steve")).toBe("reset");
    const request = session.beginRefresh();
    expect(session.authChanged("SIGNED_IN", "steve")).toBe("ignore");
    expect(session.authChanged("TOKEN_REFRESHED", "steve")).toBe("ignore");
    expect(session.authChanged("INITIAL_SESSION", "steve")).toBe("ignore");
    expect(session.isCurrent(request)).toBe(true);
  });

  it("accepts sign-in before INITIAL_SESSION without loading twice", () => {
    const session = createWorkspaceSession();
    expect(session.authChanged("SIGNED_IN", "steve")).toBe("reset");
    expect(session.authChanged("INITIAL_SESSION", "steve")).toBe("ignore");
  });

  it("restores a recovered token identity after INITIAL_SESSION could not restore it", () => {
    const session = createWorkspaceSession();
    expect(session.authChanged("INITIAL_SESSION", null)).toBe("restore");
    const signedOutGeneration = session.snapshot();
    expect(session.authChanged("TOKEN_REFRESHED", "steve")).toBe("reset");
    expect(session.isCurrent(signedOutGeneration)).toBe(false);
    const restoredGeneration = session.beginRefresh();
    expect(session.authChanged("TOKEN_REFRESHED", "steve")).toBe("ignore");
    expect(session.isCurrent(restoredGeneration)).toBe(true);
  });

  it("accepts a newly authenticated token identity and ignores refresh events without an identity", () => {
    const session = createWorkspaceSession();
    expect(session.authChanged("TOKEN_REFRESHED", null)).toBe("ignore");
    expect(session.authChanged("TOKEN_REFRESHED", "steve")).toBe("reset");
    const steveGeneration = session.beginRefresh();
    expect(session.authChanged("TOKEN_REFRESHED", null)).toBe("ignore");
    expect(session.isCurrent(steveGeneration)).toBe(true);
    expect(session.authChanged("TOKEN_REFRESHED", "another-member")).toBe("reset");
    expect(session.isCurrent(steveGeneration)).toBe(false);
  });

  it("invalidates in-flight content immediately when signing out or switching accounts", () => {
    const session = createWorkspaceSession();
    session.authChanged("INITIAL_SESSION", "steve");
    const steveRequest = session.beginRefresh();
    expect(session.authChanged("SIGNED_IN", "another-member")).toBe("reset");
    expect(session.isCurrent(steveRequest)).toBe(false);
    const otherRequest = session.beginRefresh();
    expect(session.authChanged("SIGNED_OUT", null)).toBe("signed_out");
    expect(session.isCurrent(otherRequest)).toBe(false);
    expect(session.authChanged("SIGNED_OUT", null)).toBe("ignore");
  });

  it("shows signed-out state initially and revalidates an updated member", () => {
    const session = createWorkspaceSession();
    expect(session.authChanged("INITIAL_SESSION", null)).toBe("restore");
    expect(session.authChanged("SIGNED_IN", "steve")).toBe("reset");
    expect(session.authChanged("USER_UPDATED", "steve")).toBe("refresh");
  });

  it("does not let an ambiguous initial callback erase an already restored member", () => {
    const session = createWorkspaceSession();
    session.authChanged("SIGNED_IN", "steve");
    const current = session.beginRefresh();
    expect(session.authChanged("INITIAL_SESSION", null)).toBe("ignore");
    expect(session.isCurrent(current)).toBe(true);
    expect(session.authChanged("SIGNED_OUT", null)).toBe("signed_out");
    expect(session.isCurrent(current)).toBe(false);
  });

  it("invalidates an initial session check when an explicit sign-out arrives", () => {
    const session = createWorkspaceSession();
    expect(session.authChanged("INITIAL_SESSION", null)).toBe("restore");
    const restoring = session.beginRefresh();
    expect(session.authChanged("SIGNED_OUT", null)).toBe("signed_out");
    expect(session.isCurrent(restoring)).toBe(false);
    expect(session.authChanged("INITIAL_SESSION", null)).toBe("ignore");
    expect(session.authChanged("SIGNED_OUT", null)).toBe("ignore");
  });

  it("discards obsolete refresh results and results after disposal", () => {
    const session = createWorkspaceSession();
    const previous = session.beginRefresh();
    const current = session.beginRefresh();
    expect(session.isCurrent(previous)).toBe(false);
    expect(session.isCurrent(current)).toBe(true);
    session.invalidate();
    expect(session.isCurrent(current)).toBe(false);
  });
});
