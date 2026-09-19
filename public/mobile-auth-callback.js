export const NATIVE_AUTH_SCHEME = "com.dirtyturf.academy://auth/callback";
export const ANDROID_PACKAGE = "com.dirtyturf.academy";

const QUERY_KEYS = ["code", "sb_flow_id", "error", "error_code", "error_description"];
const FRAGMENT_KEYS = ["access_token", "refresh_token", "expires_in", "expires_at", "token_type", "type"];

export function buildNativeAuthUrl(search = "", hash = "") {
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const callback = new URL(NATIVE_AUTH_SCHEME);

  for (const key of QUERY_KEYS) {
    const value = query.get(key);
    if (value) callback.searchParams.set(key, value);
  }

  const nativeFragment = new URLSearchParams();
  for (const key of FRAGMENT_KEYS) {
    const value = fragment.get(key);
    if (value) nativeFragment.set(key, value);
  }
  callback.hash = nativeFragment.toString();
  return callback.toString();
}

export function buildAndroidIntentUrl(nativeUrl) {
  const callback = new URL(nativeUrl);
  if (callback.hash) return nativeUrl;
  return `intent://${callback.host}${callback.pathname}${callback.search}#Intent;scheme=${callback.protocol.slice(0, -1)};package=${ANDROID_PACKAGE};end`;
}

export function preferredAppUrl(nativeUrl, userAgent = "") {
  return /Android/i.test(userAgent) ? buildAndroidIntentUrl(nativeUrl) : nativeUrl;
}

export function initializeMobileAuthCallback(
  documentRef = document,
  locationRef = window.location,
  userAgent = navigator.userAgent,
) {
  const button = documentRef.querySelector("[data-open-app]");
  const status = documentRef.querySelector("[data-auth-status]");
  const nativeUrl = buildNativeAuthUrl(locationRef.search, locationRef.hash);
  const parsed = new URL(nativeUrl);
  const error = parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
  const hasCredentials = parsed.searchParams.has("code") || parsed.hash.includes("access_token=");

  if (!(button instanceof HTMLAnchorElement) || !(status instanceof HTMLElement)) return;
  if (error) {
    button.hidden = true;
    status.textContent = error;
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
