export type WorkspaceAuthAction = "ignore" | "reset" | "refresh" | "signed_out";

/** Distinguish a new account from Supabase confirming the current session on resume. */
export function createWorkspaceSession() {
  let userId: string | null | undefined;
  let generation = 0;

  return {
    authChanged(event: string, nextUserId: string | null): WorkspaceAuthAction {
      if (!["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return "ignore";
      if (userId !== nextUserId) {
        userId = nextUserId;
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
