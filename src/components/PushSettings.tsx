import { useEffect, useRef, useState } from "react";
import { disableNativePush, enableNativePush, readNativePushStatus, saveNativePushPreferences, subscribeNativePushStatus, type NativePushStatus, type PushPreferences } from "../lib/nativePush";

const communityKeys = ["push_replies", "push_mentions", "push_reactions", "push_all_new_posts", "push_new_posts", "push_new_members", "push_admin_announcements", "push_event_reminders"] as const;
export function PushSettings({ readOnly = false, onToast }: { readOnly?: boolean; onToast: (message: string) => void }) {
  const [status, setStatus] = useState<NativePushStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { if (!readOnly) void readNativePushStatus().then(value => { if (mounted) { setStatus(value); setError(""); } }).catch(() => { if (mounted) setError("Phone notification settings could not load."); }); };
    refresh(); const unsubscribe = subscribeNativePushStatus(refresh);
    return () => { mounted = false; unsubscribe(); };
  }, [readOnly, retry]);
  const act = async (action: () => Promise<void>) => {
    if (pending.current || readOnly) return;
    pending.current = true;
    setBusy(true); setError("");
    try { await action(); setStatus(await readNativePushStatus()); }
    catch (cause) { const message = cause instanceof Error ? cause.message : "Phone notification settings could not be saved."; setError(message); onToast(message); }
    finally { pending.current = false; setBusy(false); }
  };
  const communityOn = Boolean(status && communityKeys.some(key => status.preferences[key]));
  const groupedPreferences = (community: boolean | undefined, courses: boolean, appUpdates: boolean): PushPreferences => ({
    ...status!.preferences,
    ...Object.fromEntries(communityKeys.map(key => [key, (community === undefined ? status!.preferences[key] : community) && (status?.communityAlertsReady === true || !["push_all_new_posts", "push_new_members"].includes(key))])),
    push_course_updates: courses,
    push_app_updates: appUpdates,
  });
  const saveGroups = (community: boolean | undefined, courses: boolean, appUpdates: boolean) => saveNativePushPreferences(groupedPreferences(community, courses, appUpdates), status?.communityAlertsReady === true, status?.appUpdateAlertsReady === true);
  if (status?.supported === false) return <div className="setting-group"><h3>Phone notifications</h3><p>Phone notifications need a supported iPhone or Android app version. Email and in-app notifications are managed separately.</p></div>;
  return <div className="setting-group notification-settings"><h3>Phone notifications</h3>
    <p>Turn phone alerts on or off, then choose the updates you want. Notification previews keep discussion details private.</p>
    {error && <p role="alert">{error} <button type="button" disabled={busy || readOnly} onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
    {status ? <><label className="toggle-row"><span>Phone notifications</span><input type="checkbox" role="switch" checked={status.enabled} disabled={busy || readOnly || (!status.ready && !status.enabled)} onChange={event => void act(event.target.checked ? enableNativePush : disableNativePush)} /><i aria-hidden="true" /></label>
      {!status.ready && <p>Phone notifications are not available yet. Email and in-app alerts remain available.</p>}
      <label className="toggle-row"><span><strong>Community</strong><small>Posts, replies, mentions, new members and events</small></span><input type="checkbox" role="switch" checked={communityOn} disabled={busy || readOnly || !status.enabled} onChange={event => { const checked = event.target.checked; void act(() => saveGroups(checked, status.preferences.push_course_updates, status.preferences.push_app_updates !== false)); }} /><i aria-hidden="true" /></label>
      <label className="toggle-row"><span><strong>Courses</strong><small>New lessons and published course updates</small></span><input type="checkbox" role="switch" checked={status.preferences.push_course_updates} disabled={busy || readOnly || !status.enabled} onChange={event => { const checked = event.target.checked; void act(() => saveGroups(undefined, checked, status.preferences.push_app_updates !== false)); }} /><i aria-hidden="true" /></label>
      <label className="toggle-row"><span><strong>App updates</strong><small>New app versions in the stores</small></span><input type="checkbox" role="switch" checked={status.preferences.push_app_updates !== false} disabled={busy || readOnly || !status.enabled || status.appUpdateAlertsReady !== true} onChange={event => { const checked = event.target.checked; void act(() => saveGroups(undefined, status.preferences.push_course_updates, checked)); }} /><i aria-hidden="true" /></label>
      {status.communityAlertsReady === false && <p>All-post and new-member alerts are waiting for the notification update. Your existing choices still work.</p>}
      {status.appUpdateAlertsReady !== true && <p>App update alerts are waiting for release setup.</p>}
      {status.permission === "denied" && <p>Notifications are blocked by your phone. Allow them in system settings before enabling them here.</p>}
      <p>The main switch stops all phone alerts. Your category choices stay saved. Phone alerts pause from 10pm to 8am in your phone’s timezone.</p>
    </> : <p role="status">{readOnly ? "Connect again to manage phone notifications." : "Loading phone notification settings…"}</p>}
    {busy && <p role="status">Saving phone notification settings…</p>}
  </div>;
}
