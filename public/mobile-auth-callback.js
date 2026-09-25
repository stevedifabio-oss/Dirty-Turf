export const NATIVE_AUTH_SCHEME = "com.dirtyturf.academy://auth/callback";
export const ANDROID_PACKAGE = "com.dirtyturf.academy";

const QUERY_KEYS = ["code", "sb_flow_id", "error", "error_code", "error_description"];

export function buildNativeAuthUrl(search = "") {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const callback = new URL(NATIVE_AUTH_SCHEME);

  for (const key of QUERY_KEYS) {
    const value = query.get(key);
    if (value) callback.searchParams.set(key, value);
  }

  return callback.toString();
}

export function buildAndroidIntentUrl(nativeUrl) {
  const callback = new URL(nativeUrl);
  return `intent://${callback.host}${callback.pathname}${callback.search}#Intent;scheme=${callback.protocol.slice(0, -1)};package=${ANDROID_PACKAGE};end`;
}

export function preferredAppUrl(nativeUrl, userAgent = "") {
  // The intent URL is Chrome-specific; use the registered scheme in Samsung Internet.
  return /Android/i.test(userAgent) && !/SamsungBrowser\//i.test(userAgent)
    ? buildAndroidIntentUrl(nativeUrl)
    : nativeUrl;
}

export function initializeMobileAuthCallback(
  documentRef = document,
  locationRef = window.location,
  userAgent = navigator.userAgent,
) {
  const button = documentRef.querySelector("[data-open-app]");
  const status = documentRef.querySelector("[data-auth-status]");
  const fragment = new URLSearchParams(locationRef.hash.replace(/^#/, ""));
  const hasLegacyTokens = fragment.has("access_token") || fragment.has("refresh_token");
  const nativeUrl = buildNativeAuthUrl(locationRef.search);
  const parsed = new URL(nativeUrl);
  const error = parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
  const hasCredentials = parsed.searchParams.has("code");

  if (!(button instanceof HTMLAnchorElement) || !(status instanceof HTMLElement)) return;
  if (error) {
    button.hidden = true;
    status.textContent = error;
    status.dataset.state = "error";
    return;
  }
  if (hasLegacyTokens) {
    button.hidden = true;
    status.textContent = "For your security, this older sign-in link cannot open the app. Return to the app and request a new link.";
    status.dataset.state = "error";
    return;
  }
  if (!hasCredentials) {
    button.hidden = true;
    status.textContent = "This sign-in link is incomplete. Return to the app and request a new link.";
    status.dataset.state = "error";
    return;
  }

  button.href = preferredAppUrl(nativeUrl, userAgent);
  button.hidden = false;
  status.textContent = "Your email is verified. Open the installed app to finish signing in.";
  status.dataset.state = "ready";
}

if (typeof document !== "undefined") initializeMobileAuthCallback();
