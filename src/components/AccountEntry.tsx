import { useState } from "react";
import { TermsChoice } from "./TermsConsent";
import { createPasswordAccount, newPasswordError, requestPasswordReset, saveRecoveredPassword } from "../lib/passwordAccount";
import { MemberProfileExample } from "./MemberProfileOnboarding";

type Mode = "signin" | "signup" | "forgot" | "magic";
type Props = {
  onPasswordSignIn: (email: string, password: string) => Promise<void>;
  onRequestMagicLink: (email: string) => Promise<void>;
  onConsentChange: (accepted: boolean) => void;
  sample?: boolean;
};
export function AccountEntry({ onPasswordSignIn, onRequestMagicLink, onConsentChange, sample = false }: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [agreed, setAgreed] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [sampleProfile, setSampleProfile] = useState(false);
  const switchMode = (next: Mode) => { setMode(next); setPassword(""); setConfirmation(""); setMessage(""); };
  if (sampleProfile) return <><p className="launch-message" role="status">Email confirmation simulated. No email was sent and no account was created.</p><MemberProfileExample /></>;
  const hasPassword = mode === "signin" || mode === "signup";
  return <>
    <h1>{mode === "signup" ? "Create your account." : mode === "forgot" ? "Reset your password." : "Welcome back."}</h1>
    <p className="launch-copy">{mode === "signup" ? "Create your login, confirm your email, then complete your member profile. Creating an account does not include paid access." : mode === "forgot" ? "Enter your account email. We’ll send a secure link to choose a new password." : mode === "magic" ? "Get a secure sign-in link by email." : "Sign in with your email address and password."}</p>
    {sample && <p className="launch-notice">EXAMPLE ONLY · Nothing is sent or saved.</p>}
    <form className="access-form" onSubmit={async event => {
      event.preventDefault(); if (busy || !email.trim() || mode !== "forgot" && !agreed) return;
      if (mode === "signup") { const invalid = newPasswordError(password, confirmation); if (invalid) { setMessage(invalid); return; } }
      setBusy(true); setMessage("");
      try {
        if (sample) {
          if (mode === "signup") setSampleProfile(true);
          else setMessage(mode === "forgot" ? "Example: a reset link would be sent if an account exists. Nothing was sent." : "Example only. No real sign-in was attempted.");
        } else if (mode === "signin") await onPasswordSignIn(email.trim(), password);
        else if (mode === "signup") { await createPasswordAccount(email, password, confirmation); setMessage("Check your inbox to confirm your email and continue. If you already have an account, sign in or use Forgot password. Creating a login does not purchase access."); }
        else if (mode === "forgot") { await requestPasswordReset(email); setMessage("If an account exists for this email, a password reset link is on the way. Check your inbox and spam folder. Open it on the device where you requested it."); }
        else { await onRequestMagicLink(email.trim()); setMessage("If this email has Academy access, a secure sign-in link is on the way."); }
        setPassword(""); setConfirmation("");
      } catch (error) { setMessage(mode === "signin" ? "Those credentials could not be verified. Check them or use Forgot password." : error instanceof Error ? error.message : "Please try again shortly."); }
      finally { setBusy(false); }
    }}>
      <label>Email address<input type="email" autoComplete="username" inputMode="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
      {hasPassword && <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 12 : undefined} maxLength={mode === "signup" ? 128 : undefined} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>}
      {mode === "signup" && <><label>Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label><small>Use at least 12 characters.</small></>}
      {mode !== "forgot" && <TermsChoice checked={agreed} disabled={busy} onChange={accepted => { setAgreed(accepted); if (!sample) onConsentChange(accepted); }} />}
      <button className="primary-button wide" disabled={busy || !email.trim() || mode !== "forgot" && !agreed || hasPassword && !password}>{busy ? "Please wait…" : mode === "signup" ? sample ? "Try sample account creation" : "Create account" : mode === "forgot" ? "Send password reset link" : mode === "magic" ? "Email me a sign-in link" : "Sign in"}</button>
    </form>
    <div className="account-entry-links">
      {mode === "signin" && <><button type="button" className="launch-auth-switch" disabled={busy} onClick={() => switchMode("forgot")}>Forgot password?</button><button type="button" className="launch-auth-switch" disabled={busy} onClick={() => switchMode("signup")}>Create an account</button></>}
      {mode !== "signin" && <button type="button" className="launch-auth-switch" disabled={busy} onClick={() => switchMode("signin")}>Back to sign in</button>}
      {mode === "signin" && <button type="button" className="launch-auth-switch" disabled={busy} onClick={() => switchMode("magic")}>Email me a sign-in link instead</button>}
    </div>
    {message && <p className="launch-message" role="status">{message}</p>}
  </>;
}
export function PasswordResetForm({ userId, onComplete, onSignOut }: { userId: string; onComplete: () => void; onSignOut: () => void }) {
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <main className="launch-gate"><section className="launch-card"><img src="/dirty-turf-logo.png" alt="Dirty Turf" /><h1>Choose a new password.</h1><p className="launch-copy">Use at least 12 characters. This updates your Dirty Turf login on the web, Android and iPhone.</p>
    <form className="access-form" onSubmit={async event => { event.preventDefault(); if (busy) return; const invalid = newPasswordError(password, confirmation); if (invalid) { setMessage(invalid); return; } setBusy(true); setMessage(""); try { await saveRecoveredPassword(userId, password, confirmation); setPassword(""); setConfirmation(""); onComplete(); } catch (error) { setMessage(error instanceof Error ? error.message : "Please request a new reset link."); } finally { setBusy(false); } }}>
      <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      <button className="primary-button wide" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
    </form>{message && <p role="alert" className="launch-message">{message}</p>}<button className="launch-auth-switch" disabled={busy} onClick={onSignOut}>Cancel and sign out</button>
  </section></main>;
}
export function AccountEntryExample() {
  return <main className="launch-gate"><section className="launch-card"><img src="/dirty-turf-logo.png" alt="Dirty Turf" /><AccountEntry sample onConsentChange={() => undefined} onRequestMagicLink={async () => undefined} onPasswordSignIn={async () => undefined} /></section></main>;
}
