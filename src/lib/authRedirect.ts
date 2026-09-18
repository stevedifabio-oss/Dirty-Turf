export const NATIVE_AUTH_REDIRECT = "com.dirtyturf.academy://auth/callback";

export type NativeAuthRedirect = {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
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
  const error = url.searchParams.get("error_description")
    ?? fragment.get("error_description")
    ?? url.searchParams.get("error")
    ?? fragment.get("error")
    ?? undefined;
  return {
    code: url.searchParams.get("code") ?? undefined,
    accessToken: fragment.get("access_token") ?? url.searchParams.get("access_token") ?? undefined,
    refreshToken: fragment.get("refresh_token") ?? url.searchParams.get("refresh_token") ?? undefined,
    error,
  };
}
