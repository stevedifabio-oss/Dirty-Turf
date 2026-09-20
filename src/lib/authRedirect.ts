export const NATIVE_AUTH_REDIRECT = "com.dirtyturf.academy://auth/callback";
export const NATIVE_AUTH_EMAIL_REDIRECT = "https://app.dirtyturf.com/mobile-auth-callback.html";
export const UNSAFE_NATIVE_TOKEN_REDIRECT_ERROR = "For your security, this older sign-in link is not supported. Request a new sign-in link in the app.";

export type NativeAuthRedirect = {
  code?: string;
  flowId?: string;
  error?: string;
};

export function parseNativeAuthRedirect(rawUrl: string): NativeAuthRedirect | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "com.dirtyturf.academy:" || url.hostname !== "auth" || url.pathname !== "/callback") {
    return null;
  }

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const hasLegacyTokens = fragment.has("access_token")
    || fragment.has("refresh_token")
    || url.searchParams.has("access_token")
    || url.searchParams.has("refresh_token");
  const error = url.searchParams.get("error_description")
    ?? fragment.get("error_description")
    ?? url.searchParams.get("error")
    ?? fragment.get("error")
    ?? undefined;
  return {
    code: url.searchParams.get("code") ?? undefined,
    flowId: url.searchParams.get("sb_flow_id") ?? undefined,
    error: hasLegacyTokens ? UNSAFE_NATIVE_TOKEN_REDIRECT_ERROR : error,
  };
}
