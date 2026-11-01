import { useEffect, useState, type ReactNode } from "react";
import { emptyMemberProfile, loadOwnMemberProfile, saveOwnMemberProfile, validateMemberProfile, validateProfilePhoto, type MemberProfile } from "../lib/memberProfile";
import "./MemberProfileOnboarding.css";

export function MemberProfileBoundary({ userId, children, onSignOut }: { userId: string | null; children: ReactNode; onSignOut: () => void }) {
  return userId ? <SignedInProfile key={userId} userId={userId} onSignOut={onSignOut}>{children}</SignedInProfile> : children;
}
function SignedInProfile({ userId, children, onSignOut }: { userId: string; children: ReactNode; onSignOut: () => void }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof loadOwnMemberProfile>> | null>(null);
  const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; setError(""); void loadOwnMemberProfile().then(value => { if (active) setState(value); }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [userId, retry]);
  if (!state) return <main className="member-profile-page"><section><h1>Getting your account ready</h1>{error ? <><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry</button><button onClick={onSignOut}>Sign out</button></> : <p role="status">Loading your profile…</p>}</section></main>;
  if (!state.required) return children;
  return <MemberProfileForm initial={state.profile} onSignOut={onSignOut} onSave={async (profile, photo) => { await saveOwnMemberProfile(profile, photo, userId); setState({ required: false, profile }); }} />;
}
export function MemberProfileForm({ initial = emptyMemberProfile, onSave, onSignOut, sample = false }: { initial?: MemberProfile; onSave: (profile: MemberProfile, photo: File | null) => Promise<void>; onSignOut?: () => void; sample?: boolean }) {
  const [profile, setProfile] = useState({ ...initial }); const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!photo) { setPreview(""); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  const field = (key: keyof MemberProfile, value: string) => setProfile(current => ({ ...current, [key]: value }));
  return <main className="member-profile-page"><section>
    <img className="member-profile-brand" src="/dirty-turf-logo.png" alt="Dirty Turf" />
    <span className="member-profile-eyebrow">{sample ? "SIGN-UP EXAMPLE · NOTHING IS SAVED" : "WELCOME TO DIRTY TURF"}</span>
    <h1>Tell us about yourself.</h1><p>Complete your member profile to get started. All fields are required.</p>
    <form onSubmit={async event => { event.preventDefault(); const invalid = validateMemberProfile({ ...profile, avatarPath: photo ? "selected" : profile.avatarPath }); if (invalid) { setError(invalid); return; } setBusy(true); setError(""); try { await onSave(profile, photo); } catch (error) { setError(error instanceof Error ? error.message : "Profile could not be saved."); } finally { setBusy(false); } }}>
      <fieldset disabled={busy}>
        <label>Profile photo {preview && <img className="member-profile-avatar" src={preview} alt="Your selected profile photo" />}<input type="file" accept="image/jpeg,image/png,image/webp" required={!profile.avatarPath && !photo} onChange={event => { const file = event.target.files?.[0]; if (!file) return; const invalid = validateProfilePhoto(file); if (invalid) { setError(invalid); event.target.value = ""; setPhoto(null); return; } setError(""); setPhoto(file); }} /><small>JPG, PNG or WebP · maximum 5 MB</small></label>
        <label>Full name<input autoComplete="name" required minLength={2} maxLength={100} value={profile.name} onChange={event => field("name", event.target.value)} /></label>
        <label>Phone number<input type="tel" autoComplete="tel" required maxLength={40} placeholder="+1 (555) 123-4567" value={profile.phone} onChange={event => field("phone", event.target.value)} /><small>Private. Your phone number is not shown to other members.</small></label>
        <label>Where are you located?<input autoComplete="address-level2" required minLength={2} maxLength={160} placeholder="City, state or region, country" value={profile.location} onChange={event => field("location", event.target.value)} /><small>No street address needed.</small></label>
        <label>How long have you been cleaning turf?<select required value={profile.experience} onChange={event => field("experience", event.target.value)}><option value="" disabled>Select your experience</option><option value="just_started">Just started</option><option value="under_two_years">Under 2 years</option><option value="over_two_years">Over 2 years</option></select></label>
        <label>A little about you<textarea required minLength={10} maxLength={500} rows={4} placeholder="Tell members about yourself and your turf cleaning experience." value={profile.about} onChange={event => field("about", event.target.value)} /><small>{profile.about.length}/500 characters</small></label>
      </fieldset>
      <p className="member-profile-help">Your name, photo, location and introduction are shared in your member profile.</p>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving your profile…" : sample ? "Try sample sign-up" : "Save profile and continue"}</button>
    </form>{onSignOut && <button className="text-button" disabled={busy} onClick={onSignOut}>Sign out</button>}
  </section></main>;
}
export function MemberProfileExample() {
  const [complete, setComplete] = useState(false);
  return complete ? <main className="member-profile-page"><section><h1>You’re ready to go.</h1><p>Your profile is complete in this example. Nothing was saved or sent.</p><button onClick={() => setComplete(false)}>Try again</button></section></main> : <MemberProfileForm sample onSave={async () => setComplete(true)} />;
}
