/** Only in-memory, server-verified access may survive a temporary connection failure. */
export const OFFLINE_ACCESS_GRACE_MS = 60 * 60 * 1000;
export function createWorkspaceContinuity(now = Date.now) {
  let account: string | null = null;
  let confirmedAt: number | undefined;
  let tokenExpiresAt = 0;
  let failed = false;
  return {
    identify(userId: string | null, expiresAtSeconds?: number) {
      if (account !== userId) { account = userId; confirmedAt = undefined; failed = false; }
      tokenExpiresAt = Number.isFinite(expiresAtSeconds) ? expiresAtSeconds! * 1000 : 0;
    },
    confirm() { if (account && tokenExpiresAt > now()) { confirmedAt = now(); failed = false; } },
    fail() { failed = true; },
    revoke() { confirmedAt = undefined; failed = true; },
    canKeepLoaded() { return Boolean(account && confirmedAt !== undefined && now() < Math.min(confirmedAt + OFFLINE_ACCESS_GRACE_MS, tokenExpiresAt)); },
    canWrite(online: boolean) { return online && !failed && this.canKeepLoaded(); },
  };
}
