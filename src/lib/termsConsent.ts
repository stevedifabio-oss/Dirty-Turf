export const COMMUNITY_TERMS_VERSION = "2026-10-18";
const CONSENT_KEY = "dirty-turf-community-terms-v1";
type Receipt = { version: string; acceptedAt: string; userId: string | null };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** A consent receipt contains no credentials, callback URLs or member content. */
export function createTermsConsent(storage?: Storage, now = () => new Date()) {
  let identity: string | null | undefined;
  let receipt: Receipt | null = null;
  try {
    const value = JSON.parse(storage?.getItem(CONSENT_KEY) ?? "null");
    if (value?.version === COMMUNITY_TERMS_VERSION && typeof value.acceptedAt === "string"
      && Number.isFinite(Date.parse(value.acceptedAt))
      && (value.userId === null || typeof value.userId === "string" && value.userId.length > 0)) receipt = value;
  } catch { /* Missing or unavailable storage never implies acceptance. */ }
  const persist = () => {
    try {
      if (receipt) storage?.setItem(CONSENT_KEY, JSON.stringify(receipt));
      else storage?.removeItem(CONSENT_KEY);
    } catch { /* Explicit consent remains valid for this open session only. */ }
  };
  return {
    granted() { return Boolean(receipt && (identity === undefined || receipt.userId === identity)); },
    canProcessNativeLink() { return Boolean(receipt && (identity == null || receipt.userId === identity)); },
    identify(userId: string | null) {
      identity = userId;
      // Acceptance before requesting a sign-in link belongs to the first
      // resulting authenticated identity, without asking that person twice.
      if (userId && receipt?.userId === null) { receipt = { ...receipt, userId }; persist(); }
      return this.granted();
    },
    accept() {
      receipt = { version: COMMUNITY_TERMS_VERSION, acceptedAt: now().toISOString(), userId: identity ?? null };
      persist();
      return true;
    },
    withdraw() { receipt = null; persist(); },
  };
}
