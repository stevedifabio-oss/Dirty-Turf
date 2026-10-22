export function normalizeLoginEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

/** Retain only a safe in-app destination across a new magic-link browser tab. */
export function webMagicLinkReturnUrl(currentUrl: string) {
  const current = new URL(currentUrl);
  if (current.protocol !== "https:" && !(current.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(current.hostname))) throw new Error("Open the secure Academy website to request a sign-in link.");
  const destination = new URL("/", current.origin);
  // Billing cancellation remains reachable even when Academy access has ended.
  if (current.pathname.replace(/\/+$/, "") === "/billing") { destination.pathname = "/billing"; return destination.toString(); }
  const values = current.searchParams;
  const read = (key: string) => values.getAll(key).length === 1 ? values.get(key) : null;
  const view = read("view");
  if (["home", "learn", "community", "events", "admin", "grow"].includes(view ?? "")) destination.searchParams.set("view", view!);
  const target = (key: string) => {
    const value = read(key);
    if (value && /^[A-Za-z0-9_-]{1,128}$/.test(value)) destination.searchParams.set(key, value);
  };
  if (view === "community") {
    target("post");
    if (destination.searchParams.has("post")) target("comment");
  } else if (view === "learn") target("course");
  else if (view === "events") target("event");
  if (read("panel") === "settings") destination.searchParams.set("panel", "settings");
  return destination.toString();
}

export function memberMagicLinkOptions(redirectTo: string) {
  return {
    emailRedirectTo: redirectTo,
    shouldCreateUser: false,
  } as const;
}
