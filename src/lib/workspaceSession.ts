export type WorkspaceAuthAction = "ignore" | "reset" | "refresh" | "restore" | "signed_out";

/** Distinguish a new account from Supabase confirming the current session on resume. */
export function createWorkspaceSession() {
  let userId: string | null | undefined;
  let generation = 0;
  let restoring = false;

  return {
    authChanged(event: string, nextUserId: string | null): WorkspaceAuthAction {
      // A cold restore may emit INITIAL_SESSION with no session after a
      // transient refresh error, then recover through TOKEN_REFRESHED alone.
      if (event === "TOKEN_REFRESHED" && !nextUserId) return "ignore";
      if (!["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "TOKEN_REFRESHED"].includes(event)) return "ignore";
      if (event === "INITIAL_SESSION" && !nextUserId) {
        // Supabase emits a null initial session for a retryable restore error
        // as well as for a genuinely empty session. Check getSession outside
        // the auth callback before deciding that a new login is required.
        if (userId !== undefined) return "ignore";
        userId = null;
        restoring = true;
        generation += 1;
        return "restore";
      }
      if (event === "SIGNED_OUT" && restoring) {
        restoring = false;
        userId = null;
        generation += 1;
        return "signed_out";
      }
      if (userId !== nextUserId) {
        userId = nextUserId;
        restoring = false;
        generation += 1;
        return nextUserId ? "reset" : "signed_out";
      }
      return event === "USER_UPDATED" && nextUserId ? "refresh" : "ignore";
    },
    beginRefresh() { return ++generation; },
    snapshot() { return generation; },
    isCurrent(requestGeneration: number) { return requestGeneration === generation; },
    invalidate() { generation += 1; },
  };
}
