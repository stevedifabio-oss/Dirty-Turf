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
    expect(session.authChanged("INITIAL_SESSION", null)).toBe("signed_out");
    expect(session.authChanged("SIGNED_IN", "steve")).toBe("reset");
    expect(session.authChanged("USER_UPDATED", "steve")).toBe("refresh");
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
