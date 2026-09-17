export const ACADEMY_ORIGIN = "https://academy.dirtyturf.com";

export type AcademyDestination = "courses" | "community" | "events";

const destinationPaths: Record<AcademyDestination, string> = {
  courses: "courses/library-v2",
  community: "communities",
  events: "communities",
};

function safeSessionKey(value: string | null | undefined) {
  const key = value?.trim();
  if (!key || key.length > 4096 || key.includes("{{") || key.includes("}}")) return undefined;
  if (key === "undefined" || key === "null") return undefined;
  return key;
}

export function buildAcademyUrl(destination: AcademyDestination, sessionKey?: string | null) {
  const url = new URL(ACADEMY_ORIGIN);
  const key = safeSessionKey(sessionKey);

  if (key) url.searchParams.set("sessionKey", key);
  url.searchParams.set("redirectUrl", destinationPaths[destination]);

  return url.toString();
}

export function consumeAcademySessionKey() {
  if (typeof window === "undefined") return undefined;

  const url = new URL(window.location.href);
  if (!url.searchParams.has("sessionKey")) return undefined;

  const key = safeSessionKey(url.searchParams.get("sessionKey"));
  url.searchParams.delete("sessionKey");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

  return key;
}
