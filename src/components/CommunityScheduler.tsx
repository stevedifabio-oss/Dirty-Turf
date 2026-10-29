import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, LoaderCircle, Pause, Pencil, Play, Plus, RefreshCw, X } from "lucide-react";
import {
  loadCommunityScheduleOverview, nextCommunityScheduleOccurrence, saveCommunitySchedule,
  scheduleOccurrenceReason, scheduleValidationMessage, scheduleWeekdays, setCommunityScheduleState,
  type CommunitySchedule, type CommunityScheduleDraft, type CommunityScheduleOverview, type CommunityScheduleState,
} from "../lib/communityScheduler";
import "./community-scheduler.css";

type Channel = { id: string; name: string };
type Props = {
  communityId: string;
  categories: Channel[];
  members: { id: string; displayName: string }[];
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onRun: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean>;
};

const announcementChannel = (category: Channel) => category.name.toLowerCase() === "announcements";
const emptyDraft = (communityId: string, categories: Channel[], authorMemberId = ""): CommunityScheduleDraft => ({
  communityId, clientRequestId: crypto.randomUUID(), authorMemberId, categoryId: categories.find(category => !announcementChannel(category))?.id ?? "",
  title: "", body: "", kind: "once", timeZone: "America/Phoenix", startsOn: "", endsOn: null, localTime: "09:00", weekdays: [], state: "draft", catchupMinutes: 15,
});
function errorMessage(value: unknown) { return value instanceof Error ? value.message : "Scheduled publishing could not load. Try again."; }
function formatInstant(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  try { return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date); } catch { return "Date unavailable"; }
}
function cadence(schedule: CommunityScheduleDraft) {
  const days = scheduleWeekdays.filter(day => schedule.weekdays.includes(day.value)).map(day => day.short).join(", ");
  return schedule.kind === "once" ? `Once on ${schedule.startsOn}` : `Weekly on ${days || "selected days"} from ${schedule.startsOn}${schedule.endsOn ? ` through ${schedule.endsOn}` : ""}`;
}

export function CommunityScheduler({ communityId, categories, members, readOnly = false, onDirtyChange, onRun }: Props) {
  const id = useId();
  const [overview, setOverview] = useState<CommunityScheduleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState(() => emptyDraft(communityId, categories));
  const [contentType, setContentType] = useState<"post" | "announcement">("post");
  const [dirty, setDirty] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | CommunityScheduleState>("all");
  const pending = useRef(false);
  const mounted = useRef(true);
  const writable = useRef(!readOnly);
  writable.current = !readOnly;
  const loadSequence = useRef(0);
  const contextVersion = useRef(0);
  const editorRef = useRef<HTMLHeadingElement>(null);
  const locked = readOnly || Boolean(busy) || loading;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadSequence.current++; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty || Boolean(busy)); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError("");
    try {
      const result = await loadCommunityScheduleOverview(communityId);
      if (mounted.current && sequence === loadSequence.current) setOverview(result);
    } catch (caught) { if (mounted.current && sequence === loadSequence.current) setLoadError(errorMessage(caught)); }
    finally { if (mounted.current && sequence === loadSequence.current) setLoading(false); }
  }, [communityId]);
  useEffect(() => {
    contextVersion.current++;
    setOverview(null); setDraft(emptyDraft(communityId, categories)); setDirty(false); setEditorOpen(false); setActionError(""); setSuccess("");
    // A changed channel list must not discard an open editor.
  }, [communityId]);
  useEffect(() => {
    if (!readOnly) void refresh(); else { setLoading(false); setLoadError("Reconnect to load scheduled publishing."); }
  }, [communityId, readOnly, refresh]);

  const channel = categories.find(category => category.id === draft.categoryId);
  const channels = categories.filter(category => announcementChannel(category) === (contentType === "announcement"));
  const authorName = members.find(member => member.id === draft.authorMemberId)?.displayName || overview?.author.displayName || "your administrator account";
  const schedules = overview?.schedules ?? [];
  const visibleSchedules = schedules.filter(schedule => filter === "all" || schedule.state === filter);
  const invalid = scheduleValidationMessage(draft);
  const next = useMemo(() => nextCommunityScheduleOccurrence(draft), [draft]);

  const change = <Key extends keyof CommunityScheduleDraft>(key: Key, value: CommunityScheduleDraft[Key]) => {
    if (!writable.current || pending.current) return;
    setDraft(current => ({ ...current, [key]: value })); setDirty(true); setActionError(""); setSuccess("");
  };
  const mayDiscard = () => !dirty || window.confirm("Discard the unsaved changes to this scheduled post?");
  const newSchedule = () => {
    if (locked || !overview || !mayDiscard()) return;
    setDraft(emptyDraft(communityId, categories, overview.author.id)); setContentType("post"); setDirty(false); setEditorOpen(true); setPreview(false); setActionError(""); setSuccess("");
    requestAnimationFrame(() => editorRef.current?.focus());
  };
  const edit = (schedule: CommunitySchedule) => {
    if (locked || schedule.state === "cancelled" || schedule.createdBy !== overview?.currentUserId || !mayDiscard()) return;
    setDraft({ ...schedule, expectedRevision: schedule.revision, weekdays: [...schedule.weekdays] }); setContentType(schedule.isAnnouncement ? "announcement" : "post"); setDirty(false); setEditorOpen(true); setPreview(false); setActionError(""); setSuccess("");
    requestAnimationFrame(() => editorRef.current?.focus());
  };
  const run = async (label: string, action: () => Promise<CommunitySchedule>, message: string, savedEditor = false) => {
    if (!writable.current || pending.current) return;
    pending.current = true; setBusy(label); setActionError(""); setSuccess("");
    const version = contextVersion.current;
    const current = () => mounted.current && version === contextVersion.current;
    let saved: CommunitySchedule | undefined;
    try {
      const confirmed = await onRun(`schedule-${label}`, async () => {
        try { saved = await action(); }
        catch (caught) { if (current()) setActionError(errorMessage(caught)); throw caught; }
      }, message);
      if (current() && confirmed && saved) {
        const result = saved;
        setOverview(current => current ? { ...current, schedules: [result, ...current.schedules.filter(item => item.id !== result.id)] } : current);
        if (savedEditor || draft.id === result.id) { setDraft({ ...result, expectedRevision: result.revision }); setDirty(false); }
        setSuccess(message);
      } else if (current() && !confirmed) setActionError(current => current || "The change could not be confirmed. Refresh before retrying.");
    } catch (caught) { if (current()) setActionError(errorMessage(caught)); }
    finally { pending.current = false; if (mounted.current) setBusy(""); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (locked || !overview) return;
    if (invalid) { setActionError(invalid); return; }
    if (!channel || announcementChannel(channel) !== (contentType === "announcement")) { setActionError("Choose a channel that matches this post type."); return; }
    if (draft.id && draft.state === "active" && !window.confirm("Save changes to this active schedule? Future posts will use this content and audience.")) return;
    void run("save", () => saveCommunitySchedule(draft, overview.currentUserId), draft.id ? "Schedule changes saved." : "Draft saved. Activate it separately when automatic publishing is available.", true);
  };
  const changeState = (schedule: CommunitySchedule, state: CommunityScheduleState) => {
    if (locked || !overview || (state === "active" && !overview.status.databaseEnabled)) return;
    if (draft.id === schedule.id && dirty) { setActionError("Save or discard this post’s unsaved changes before changing its state."); return; }
    if (state === "active") {
      const occurrence = nextCommunityScheduleOccurrence(schedule);
      if (!occurrence) { setActionError("This schedule has no future publishing time. Edit its dates before activating it."); return; }
      const audience = schedule.isAnnouncement ? "eligible Academy members" : "members who follow the author";
      if (!window.confirm(`Activate “${schedule.title}”? It will publish automatically, starting ${formatInstant(occurrence, schedule.timeZone)} (${schedule.timeZone}). Notifications address ${audience} and follow their preferences.`)) return;
    }
    if (state === "cancelled" && !window.confirm(`Cancel “${schedule.title}”? Future occurrences will stop. Already published posts and history are kept. This schedule cannot be reactivated.`)) return;
    const message = state === "active" ? "Schedule activated. Delivery still depends on the configured publishing and notification services." : state === "paused" ? "Schedule paused. Future posts are on hold." : "Schedule cancelled. Its publishing history is kept.";
    void run(`${state}-${schedule.id}`, () => setCommunityScheduleState(schedule, state, overview.currentUserId), message);
  };

  return <section className="community-scheduler" aria-labelledby={`${id}-heading`}>
    <header className="community-scheduler-heading"><div><h3 id={`${id}-heading`}><CalendarClock size={19} /> Scheduled publishing</h3><p>Prepare posts and announcements, then let an active schedule publish them at the agreed time.</p></div><div className="community-scheduler-tools"><button type="button" className="secondary-button" disabled={locked || loading} onClick={() => void refresh()} aria-label="Refresh scheduled publishing"><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh</button><button type="button" className="primary-button" disabled={locked || !overview} onClick={newSchedule}><Plus size={16} /> New scheduled post</button></div></header>
    {overview && <div className="community-scheduler-notice"><strong>{overview.status.databaseEnabled ? "Publishing schedules are enabled." : "Automatic publishing is paused. You can prepare drafts."}</strong><p>{overview.status.databaseEnabled ? "Active schedules depend on the configured publishing service. A published post in history confirms publication; notification delivery is tracked separately." : "Drafts do not publish or notify members. Activation becomes available after the publishing setup is enabled."}</p></div>}
    <p className="community-scheduler-audience">Announcements address eligible Academy members. Ordinary posts notify the author’s followers. Email and phone push follow each member’s choices and the available delivery setup.</p>
    {loadError && <div className="community-scheduler-feedback" role="alert"><p>{loadError} {overview ? "Previously loaded schedules are still shown." : "No changes have been made."}</p><button type="button" className="secondary-button" disabled={locked || loading || readOnly} onClick={() => void refresh()}>Try loading again</button></div>}
    {loading && <p role="status" className="community-scheduler-loading"><LoaderCircle size={17} className="spin" /> Loading scheduled posts…</p>}
    {actionError && <p className="community-scheduler-error" role="alert">{actionError}</p>}
    {success && <p className="community-scheduler-success" role="status"><Check size={17} /> {success}</p>}
    {editorOpen && overview && <section className="community-scheduler-editor" aria-labelledby={`${id}-editor-heading`}>
      <header><div><h4 id={`${id}-editor-heading`} ref={editorRef} tabIndex={-1}>{draft.id ? "Edit scheduled post" : "New scheduled post"}</h4><p>Publishing as <strong>{authorName}</strong>. New schedules save as drafts.</p></div><button type="button" className="admin-text-action" disabled={locked} aria-label="Close scheduled post editor" onClick={() => { if (mayDiscard()) { setEditorOpen(false); setDirty(false); } }}><X size={17} /> Close</button></header>
      <form onSubmit={submit} aria-label="Scheduled post editor"><fieldset disabled={locked || Boolean(loadError) || draft.state === "cancelled"}>
        <div className="community-scheduler-grid"><label>Post type<select value={contentType} onChange={event => { if (locked) return; const type = event.target.value as "post" | "announcement"; setContentType(type); change("categoryId", categories.find(category => announcementChannel(category) === (type === "announcement"))?.id ?? ""); }}><option value="post">Community post</option><option value="announcement">Announcement</option></select></label><label>Channel<select value={draft.categoryId} onChange={event => change("categoryId", event.target.value)} required><option value="">Choose a channel</option>{channels.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select>{!channels.length && <small>No {contentType === "announcement" ? "Announcements" : "ordinary post"} channel is available.</small>}</label></div>
        <label>Post title<input value={draft.title} minLength={2} maxLength={120} required onChange={event => change("title", event.target.value)} /></label>
        <label>Post text<textarea rows={6} value={draft.body} minLength={2} maxLength={5000} required onChange={event => change("body", event.target.value)} /><small>{draft.body.length.toLocaleString()} / 5,000 characters. Use approved Academy material and general prompts. Add prices, offers or business claims only when Steve has supplied them.</small></label>
        <div className="community-scheduler-grid"><label>Schedule<select value={draft.kind} onChange={event => { const kind = event.target.value as "once" | "weekly"; change("kind", kind); change("weekdays", kind === "weekly" ? [1, 3, 5] : []); if (kind === "once") change("endsOn", null); }}><option value="once">One time</option><option value="weekly">Weekly</option></select></label><label>Time zone<input value={draft.timeZone} list={`${id}-zones`} maxLength={80} onChange={event => change("timeZone", event.target.value)} required autoComplete="off" spellCheck={false} /><datalist id={`${id}-zones`}>{["America/Phoenix", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Bogota", "UTC"].map(zone => <option value={zone} key={zone} />)}</datalist><small>Use the community’s agreed time zone, independent of this device.</small></label></div>
        <div className="community-scheduler-grid"><label>{draft.kind === "once" ? "Publishing date" : "Start date"}<input type="date" value={draft.startsOn} onChange={event => change("startsOn", event.target.value)} required /></label><label>Local publishing time<input type="time" value={draft.localTime} onChange={event => change("localTime", event.target.value)} step={60} required /></label>{draft.kind === "weekly" && <label>End date (optional)<input type="date" value={draft.endsOn ?? ""} min={draft.startsOn || undefined} onChange={event => change("endsOn", event.target.value || null)} /></label>}</div>
        {draft.kind === "weekly" && <><fieldset className="community-scheduler-weekdays"><legend>Publish on</legend>{scheduleWeekdays.map(day => <label key={day.value}><input type="checkbox" aria-label={day.label} checked={draft.weekdays.includes(day.value)} onChange={event => change("weekdays", event.target.checked ? [...draft.weekdays, day.value].sort((a, b) => a - b) : draft.weekdays.filter(value => value !== day.value))} /><span aria-hidden="true">{day.short}</span></label>)}</fieldset><p className="community-scheduler-help">A weekly schedule repeats this exact post. Create separate one-time drafts when Monday’s tip, Wednesday’s question and Friday’s wins need different content.</p></>}
        <p className="community-scheduler-timing" aria-live="polite">{next ? <>Next scheduled time: <strong>{formatInstant(next, draft.timeZone)}</strong> ({draft.timeZone}).</> : "Choose future dates and a valid time zone to preview the next publishing time."}</p>
        <p className="community-scheduler-help">If publishing is late by more than {draft.catchupMinutes} minutes, that occurrence is skipped. Missing daylight-saving times are skipped; repeated times publish once at the later instant.</p>
        {dirty && invalid && <p className="community-scheduler-help" role="status">{invalid}</p>}
        <div className="community-scheduler-actions"><button className="primary-button" disabled={locked || Boolean(invalid) || Boolean(loadError)}><Check size={16} /> {busy === "save" ? "Saving…" : draft.id ? "Save schedule changes" : "Save draft"}</button><button type="button" className="secondary-button" disabled={locked} onClick={() => setPreview(value => !value)} aria-expanded={preview} aria-controls={`${id}-preview`}>{preview ? "Hide preview" : "Preview post"}</button></div>
      </fieldset></form>
      {preview && <article className="community-scheduler-preview" id={`${id}-preview`} aria-label="Scheduled post preview"><small>Preview · {channel?.name || "Choose a channel"} · {authorName}</small><h4>{draft.title.trim() || "Your post title"}</h4><p>{draft.body.trim() || "Your post text will appear here."}</p><footer>{contentType === "announcement" ? "Announcement for eligible Academy members" : "Post for the community; notifications to author followers"}</footer></article>}
    </section>}
    {overview && <><div className="community-scheduler-list-heading"><h4>Schedules <span>{schedules.length}</span></h4><label>Show<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All schedules</option><option value="draft">Drafts</option><option value="active">Active</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option></select></label></div>
      <div className="community-scheduler-list">{visibleSchedules.map(schedule => {
        const nextOccurrence = schedule.state === "active" ? nextCommunityScheduleOccurrence(schedule) : null;
        return <article className="community-scheduler-item" key={schedule.id}><div><div className="community-scheduler-item-meta"><span className={`community-scheduler-state community-scheduler-state-${schedule.state}`}>{schedule.state}</span><small>{schedule.isAnnouncement ? "Announcement" : "Community post"} · {categories.find(category => category.id === schedule.categoryId)?.name || "Channel unavailable"}</small></div><h4>{schedule.title}</h4><p>{cadence(schedule)} at {schedule.localTime} ({schedule.timeZone})</p><small>Author: {members.find(member => member.id === schedule.authorMemberId)?.displayName || "Academy administrator"}</small>{schedule.state === "active" && <p className="community-scheduler-next">{nextOccurrence ? `Next: ${formatInstant(nextOccurrence, schedule.timeZone)} (${schedule.timeZone})` : "No future occurrence. Review this schedule’s dates."}{!overview.status.databaseEnabled && " · Publishing is paused."}</p>}</div><div className="community-scheduler-item-actions">{schedule.state !== "cancelled" && <><button type="button" className="secondary-button" disabled={locked || Boolean(loadError) || schedule.createdBy !== overview.currentUserId} title={schedule.createdBy !== overview.currentUserId ? "Only the schedule creator can edit its content. Administrators can still pause or cancel it." : undefined} onClick={() => edit(schedule)} aria-label={`Edit schedule ${schedule.title}`}><Pencil size={15} /> Edit</button>{schedule.state === "active" ? <button type="button" className="secondary-button" disabled={locked || Boolean(loadError)} onClick={() => changeState(schedule, "paused")} aria-label={`Pause schedule ${schedule.title}`}><Pause size={15} /> Pause</button> : <button type="button" className="secondary-button" disabled={locked || Boolean(loadError) || !overview.status.databaseEnabled} title={!overview.status.databaseEnabled ? "Automatic publishing must be enabled before activating a schedule." : undefined} onClick={() => changeState(schedule, "active")} aria-label={`Activate schedule ${schedule.title}`}><Play size={15} /> Activate</button>}<button type="button" className="admin-text-action" disabled={locked || Boolean(loadError)} onClick={() => changeState(schedule, "cancelled")} aria-label={`Cancel schedule ${schedule.title}`}>Cancel schedule</button></>}</div></article>;
      })}{!visibleSchedules.length && <p className="community-scheduler-empty">{schedules.length ? "No schedules match this filter." : "No scheduled posts yet. Create a draft to plan the next community update."}</p>}</div>
      <section className="community-scheduler-history"><button type="button" className="community-scheduler-history-toggle" onClick={() => setHistoryOpen(value => !value)} aria-expanded={historyOpen} aria-controls={`${id}-history`}>Publishing history <span>{overview.occurrences.length}</span></button>{historyOpen && <div id={`${id}-history`}>{overview.occurrences.length ? <ul>{overview.occurrences.map(occurrence => {
        const zone = occurrence.snapshot.timeZone;
        return <li key={occurrence.id}><div><strong>{occurrence.snapshot.title}</strong><small>{formatInstant(occurrence.scheduledFor, zone)} ({zone}) · revision {occurrence.scheduleRevision}</small></div><span className={`community-scheduler-state community-scheduler-state-${occurrence.state}`}>{occurrence.state}</span><p>{occurrence.state === "published" ? "Post published. Email and push delivery are separate." : scheduleOccurrenceReason(occurrence.reasonCode)}</p></li>;
      })}</ul> : <p className="community-scheduler-empty">No publishing attempts recorded yet. Saving a draft does not create a post or send notifications.</p>}<p className="community-scheduler-help">Showing up to 100 recent occurrences. A skipped or failed occurrence does not count as publication. One-time schedules pause after their attempt; create a new draft to publish again.</p></div>}</section>
    </>}
  </section>;
}
