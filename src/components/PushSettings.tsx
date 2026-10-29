import { useEffect, useRef, useState } from "react";
import { disableNativePush, enableNativePush, readNativePushStatus, saveNativePushPreferences, subscribeNativePushStatus, type NativePushStatus, type PushPreferences } from "../lib/nativePush";

const labels: Record<keyof PushPreferences, string> = { push_replies: "Comments and replies", push_mentions: "Mentions", push_reactions: "Likes", push_new_posts: "Posts from followed members", push_admin_announcements: "Academy announcements", push_event_reminders: "Events and reminders", push_course_updates: "Course updates" };
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
  if (status?.supported === false) return <div className="setting-group"><h3>Phone notifications</h3><p>Phone notifications need a supported iPhone or Android app version. Email and in-app notifications are managed separately.</p></div>;
  return <div className="setting-group notification-settings"><h3>Phone notifications</h3>
    <p>Choose whether this app can send alerts to your phone. Notification previews keep discussion details private.</p>
    {error && <p role="alert">{error} <button type="button" disabled={busy || readOnly} onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
    {status ? <><label className="notification-toggle"><span>Phone push notifications</span><input type="checkbox" checked={status.enabled} disabled={busy || readOnly || (!status.ready && !status.enabled)} onChange={event => void act(event.target.checked ? enableNativePush : disableNativePush)} /></label>
      {!status.ready && <p>Phone notifications are not available yet. Email and in-app alerts remain available.</p>}
      {Object.entries(labels).map(([key, label]) => <label className="notification-toggle" key={key}><span>{label}</span><input type="checkbox" checked={status.preferences[key as keyof PushPreferences]} disabled={busy || readOnly || !status.enabled} onChange={event => void act(() => saveNativePushPreferences({ ...status.preferences, [key]: event.target.checked }))} /></label>)}
      {status.permission === "denied" && <p>Notifications are blocked by your phone. Allow them in system settings before enabling them here.</p>}
      <p>Phone alerts pause from 10pm to 8am in your phone’s timezone. Older alerts expire rather than arriving in a backlog. Likes and followed-member posts are off unless you choose them.</p>
    </> : <p role="status">{readOnly ? "Connect again to manage phone notifications." : "Loading phone notification settings…"}</p>}
    {busy && <p role="status">Saving phone notification settings…</p>}
  </div>;
}
