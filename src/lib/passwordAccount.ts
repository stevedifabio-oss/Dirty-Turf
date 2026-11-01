import { normalizeLoginEmail, webMagicLinkReturnUrl } from "./memberAuth";
import { NATIVE_AUTH_EMAIL_REDIRECT } from "./authRedirect";
import { Capacitor } from "@capacitor/core";

export function newPasswordError(password: string, confirmation: string): string | null {
  if (password.length < 12 || password.length > 128) return "Use a password between 12 and 128 characters.";
  if (password !== confirmation) return "The passwords do not match.";
  return null;
}
export function accountEmailRedirect(currentUrl: string, recovery = false): string {
  if (Capacitor.isNativePlatform()) return NATIVE_AUTH_EMAIL_REDIRECT;
  const url = new URL(webMagicLinkReturnUrl(currentUrl));
  url.pathname = "/"; url.search = "";
  if (recovery) url.searchParams.set("auth", "recovery");
  return url.toString();
}
export async function createPasswordAccount(email: string, password: string, confirmation: string): Promise<void> {
  const invalid = newPasswordError(password, confirmation); if (invalid) throw new Error(invalid);
  const { supabase } = await import("./backend");
  if (!supabase) throw new Error("Account creation is unavailable in this preview.");
  // Auth creates a login only. Paid access remains controlled by the existing backend.
  const { error } = await supabase.auth.signUp({ email: normalizeLoginEmail(email), password, options: { emailRedirectTo: accountEmailRedirect(window.location.href) } });
  if (error) throw new Error("Account creation could not be completed. Try again or use Forgot password if you already have an account.");
}
export async function requestPasswordReset(email: string): Promise<void> {
  const { supabase } = await import("./backend");
  if (!supabase) throw new Error("Password recovery is unavailable in this preview.");
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeLoginEmail(email), { redirectTo: accountEmailRedirect(window.location.href, true) });
  if (error) throw new Error("The reset request could not be sent. Please try again shortly.");
}
export async function saveRecoveredPassword(userId: string, password: string, confirmation: string): Promise<void> {
  const invalid = newPasswordError(password, confirmation); if (invalid) throw new Error(invalid);
  const { supabase } = await import("./backend");
  if (!supabase) throw new Error("Password recovery is unavailable in this preview.");
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== userId) throw new Error("Your recovery session has changed or expired. Request a new reset link.");
  const result = await supabase.auth.updateUser({ password });
  if (result.error) throw new Error("Your password could not be updated. Try again or request a new reset link.");
}
